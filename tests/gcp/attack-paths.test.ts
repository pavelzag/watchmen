import { computeAttackPaths } from "@/lib/gcp/attack-paths";
import type { GcpSnapshot, ServiceAccount, FirewallRule, VM, CloudRunService, StorageBucket, Secret, ProjectIamPolicy } from "@/lib/gcp/types";

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function makeSnapshot(overrides: Partial<GcpSnapshot> = {}): GcpSnapshot {
  return {
    snapshotId: "test-snapshot",
    fetchedAt: "2024-01-01T00:00:00Z",
    projects: [],
    serviceAccounts: [],
    storageBuckets: [],
    gkeClusters: [],
    vms: [],
    cloudRunServices: [],
    cloudSqlInstances: [],
    bigqueryDatasets: [],
    pubsubTopics: [],
    secrets: [],
    firewallRules: [],
    loadBalancers: [],
    ...overrides,
  } as GcpSnapshot;
}

function makeSA(email: string, roles: string[], projectId = "proj-1"): ServiceAccount {
  return {
    name: `projects/${projectId}/serviceAccounts/${email}`,
    projectId,
    uniqueId: email,
    email,
    displayName: email,
    disabled: false,
    roles,
    keys: [],
  };
}

function makeFirewall(overrides: Partial<FirewallRule> = {}): FirewallRule {
  return {
    name: "fw-open-ssh",
    projectId: "proj-1",
    network: "default",
    direction: "INGRESS",
    priority: 1000,
    sourceRanges: ["0.0.0.0/0"],
    allowed: [{ IPProtocol: "tcp", ports: ["22"] }],
    disabled: false,
    ...overrides,
  };
}

function makeVM(overrides: Partial<VM> = {}): VM {
  return {
    name: "my-vm",
    projectId: "proj-1",
    zone: "us-central1-a",
    machineType: "n1-standard-1",
    status: "RUNNING",
    internalIp: "10.0.0.1",
    externalIp: "1.2.3.4",
    serviceAccount: "admin-sa@proj-1.iam.gserviceaccount.com",
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("computeAttackPaths", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── 1. pathsFirewallVmSa ────────────────────────────────────────────────────
  describe("pathsFirewallVmSa", () => {
    const saEmail = "admin-sa@proj-1.iam.gserviceaccount.com";
    const privilegedSA = makeSA(saEmail, ["roles/owner"]);
    const openFw = makeFirewall();
    const exposedVM = makeVM({ serviceAccount: saEmail });

    it("returns a critical fw-vm-sa path when open firewall, external VM, and privileged SA align", () => {
      const snapshot = makeSnapshot({
        serviceAccounts: [privilegedSA],
        firewallRules: [openFw],
        vms: [exposedVM],
      });

      const paths = computeAttackPaths(snapshot);
      const fwPaths = paths.filter((p) => p.id.startsWith("fw-vm-sa:"));

      expect(fwPaths.length).toBeGreaterThanOrEqual(1);
      expect(fwPaths[0].severity).toBe("critical");
      expect(fwPaths[0].title).toContain("Internet");
    });

    it("returns no fw-vm-sa path when SA has no privileged role", () => {
      const unprivSA = makeSA(saEmail, ["roles/viewer"]);
      const snapshot = makeSnapshot({
        serviceAccounts: [unprivSA],
        firewallRules: [openFw],
        vms: [exposedVM],
      });

      const paths = computeAttackPaths(snapshot);
      const fwPaths = paths.filter((p) => p.id.startsWith("fw-vm-sa:"));
      expect(fwPaths).toHaveLength(0);
    });

    it("returns no fw-vm-sa path when VM has no externalIp", () => {
      const vmNoExternal = makeVM({ externalIp: null, serviceAccount: saEmail });
      const snapshot = makeSnapshot({
        serviceAccounts: [privilegedSA],
        firewallRules: [openFw],
        vms: [vmNoExternal],
      });

      const paths = computeAttackPaths(snapshot);
      const fwPaths = paths.filter((p) => p.id.startsWith("fw-vm-sa:"));
      expect(fwPaths).toHaveLength(0);
    });
  });

  // ── 2. pathsPublicCloudRunSa ────────────────────────────────────────────────
  describe("pathsPublicCloudRunSa", () => {
    const saEmail = "editor-sa@proj-1.iam.gserviceaccount.com";
    // roles/editor is in ADMIN_ROLES → severity "critical"; use a SENSITIVE_ROLES-only
    // role (storage.admin) to produce a "high" path
    const editorSA = makeSA(saEmail, ["roles/storage.admin"]);

    const publicCloudRun: CloudRunService = {
      name: "my-public-service",
      projectId: "proj-1",
      region: "us-central1",
      url: "https://my-public-service-xyz.run.app",
      status: "RUNNING",
      serviceAccount: saEmail,
      iamPolicy: {
        bindings: [
          { role: "roles/run.invoker", members: ["allUsers"] },
        ],
      },
    };

    it("returns a high cloudrun-sa path when Cloud Run is public and SA is privileged", () => {
      const snapshot = makeSnapshot({
        serviceAccounts: [editorSA],
        cloudRunServices: [publicCloudRun],
      });

      const paths = computeAttackPaths(snapshot);
      const crPaths = paths.filter((p) => p.id.startsWith("cloudrun-sa:"));

      expect(crPaths.length).toBeGreaterThanOrEqual(1);
      expect(crPaths[0].severity).toBe("high");
    });

    it("returns no cloudrun-sa path when Cloud Run has empty iamPolicy bindings", () => {
      const privateCloudRun: CloudRunService = {
        ...publicCloudRun,
        iamPolicy: { bindings: [] },
      };
      const snapshot = makeSnapshot({
        serviceAccounts: [editorSA],
        cloudRunServices: [privateCloudRun],
      });

      const paths = computeAttackPaths(snapshot);
      const crPaths = paths.filter((p) => p.id.startsWith("cloudrun-sa:"));
      expect(crPaths).toHaveLength(0);
    });
  });

  // ── 3. pathsPublicBucket — read-only ───────────────────────────────────────
  describe("pathsPublicBucket (read-only)", () => {
    it("returns bucket-read path for a publicly readable bucket", () => {
      const bucket: StorageBucket = {
        name: "public-data-bucket",
        projectId: "proj-1",
        location: "US",
        storageClass: "STANDARD",
        versioningEnabled: false,
        iamPolicy: {
          bindings: [
            { role: "roles/storage.objectViewer", members: ["allUsers"] },
          ],
        },
      };

      const snapshot = makeSnapshot({ storageBuckets: [bucket] });
      const paths = computeAttackPaths(snapshot);

      const readPaths = paths.filter((p) => p.id === `bucket-read:${bucket.name}`);
      expect(readPaths).toHaveLength(1);
      expect(readPaths[0].severity).toBe("high");
    });
  });

  // ── 4. pathsPublicBucket — writable ───────────────────────────────────────
  describe("pathsPublicBucket (writable)", () => {
    it("returns bucket-write-sa critical path when bucket is writable and a privileged SA exists in same project", () => {
      const saEmail = "storage-admin@proj-1.iam.gserviceaccount.com";
      const privilegedSA = makeSA(saEmail, ["roles/owner"]);

      const writableBucket: StorageBucket = {
        name: "writable-bucket",
        projectId: "proj-1",
        location: "US",
        storageClass: "STANDARD",
        versioningEnabled: false,
        iamPolicy: {
          bindings: [
            { role: "roles/storage.objectAdmin", members: ["allAuthenticatedUsers"] },
          ],
        },
      };

      const snapshot = makeSnapshot({
        serviceAccounts: [privilegedSA],
        storageBuckets: [writableBucket],
      });

      const paths = computeAttackPaths(snapshot);
      const writePaths = paths.filter((p) => p.id.startsWith("bucket-write-sa:"));

      expect(writePaths.length).toBeGreaterThanOrEqual(1);
      expect(writePaths[0].severity).toBe("critical");
    });
  });

  // ── 5. pathsPublicSecret ───────────────────────────────────────────────────
  describe("pathsPublicSecret", () => {
    it("returns a critical public-secret path for a publicly accessible secret", () => {
      const secret: Secret = {
        name: "projects/proj-1/secrets/db-password",
        projectId: "proj-1",
        replicationPolicy: "automatic",
        iamPolicy: {
          bindings: [
            { role: "roles/secretmanager.secretAccessor", members: ["allUsers"] },
          ],
        },
      };

      const snapshot = makeSnapshot({ secrets: [secret] });
      const paths = computeAttackPaths(snapshot);

      const secretPaths = paths.filter((p) => p.id.startsWith("public-secret:"));
      expect(secretPaths).toHaveLength(1);
      expect(secretPaths[0].severity).toBe("critical");
    });
  });

  // ── 6. pathsUserLateralMovement ────────────────────────────────────────────
  describe("pathsUserLateralMovement", () => {
    const aliceBinding = { role: "roles/owner", members: ["user:alice@corp.com"] };

    const proj1: ProjectIamPolicy = {
      projectId: "proj-1",
      projectName: "Project One",
      bindings: [aliceBinding],
    };

    const proj2: ProjectIamPolicy = {
      projectId: "proj-2",
      projectName: "Project Two",
      bindings: [aliceBinding],
    };

    it("returns a high user-lateral path when a user is owner in two projects", () => {
      const snapshot = makeSnapshot({ projects: [proj1, proj2] });
      const paths = computeAttackPaths(snapshot);

      const lateralPaths = paths.filter((p) => p.id === "user-lateral:alice@corp.com");
      expect(lateralPaths).toHaveLength(1);
      expect(lateralPaths[0].severity).toBe("high");
    });

    it("returns no user-lateral path when the user only appears in one project", () => {
      const snapshot = makeSnapshot({ projects: [proj1] });
      const paths = computeAttackPaths(snapshot);

      const lateralPaths = paths.filter((p) => p.id === "user-lateral:alice@corp.com");
      expect(lateralPaths).toHaveLength(0);
    });
  });

  // ── 7. Deduplication ───────────────────────────────────────────────────────
  describe("deduplication", () => {
    it("does not return duplicate path IDs", () => {
      // Two buckets with the same name would be unusual, but we can test deduplication
      // by triggering a scenario with multiple path generators that might overlap.
      // Use a publicly readable bucket repeated — same name means same id.
      // Since GcpSnapshot is processed by a filter, we just verify uniqueness holds.
      const bucket: StorageBucket = {
        name: "unique-bucket",
        projectId: "proj-1",
        location: "US",
        storageClass: "STANDARD",
        versioningEnabled: false,
        iamPolicy: {
          bindings: [
            { role: "roles/storage.objectViewer", members: ["allUsers"] },
          ],
        },
      };

      // Place the same bucket twice to force duplicate IDs through the generator
      const snapshot = makeSnapshot({ storageBuckets: [bucket, { ...bucket }] });
      const paths = computeAttackPaths(snapshot);

      const ids = paths.map((p) => p.id);
      const uniqueIds = new Set(ids);
      expect(ids.length).toBe(uniqueIds.size);
    });
  });

  // ── 8. Sorting ─────────────────────────────────────────────────────────────
  describe("sorting", () => {
    it("places critical paths before high paths", () => {
      // public secret → critical
      const secret: Secret = {
        name: "projects/proj-1/secrets/my-secret",
        projectId: "proj-1",
        replicationPolicy: "automatic",
        iamPolicy: {
          bindings: [{ role: "roles/secretmanager.secretAccessor", members: ["allUsers"] }],
        },
      };

      // publicly readable bucket → high
      const bucket: StorageBucket = {
        name: "readable-bucket",
        projectId: "proj-1",
        location: "US",
        storageClass: "STANDARD",
        versioningEnabled: false,
        iamPolicy: {
          bindings: [{ role: "roles/storage.objectViewer", members: ["allUsers"] }],
        },
      };

      const snapshot = makeSnapshot({ secrets: [secret], storageBuckets: [bucket] });
      const paths = computeAttackPaths(snapshot);

      expect(paths.length).toBeGreaterThanOrEqual(2);
      // All critical paths should come before any high path
      let seenHigh = false;
      for (const path of paths) {
        if (path.severity === "high") seenHigh = true;
        if (seenHigh) {
          expect(path.severity).not.toBe("critical");
        }
      }
    });
  });
});
