/** @jest-environment node */

import { computeFindings } from "./findings";
import type { GcpSnapshot } from "./gcp/types";

function makeSnapshot(overrides: Partial<GcpSnapshot> = {}): GcpSnapshot {
  return {
    snapshotId: "snapshot-1",
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
    scanWarnings: [],
    fetchedAt: "2026-07-02T00:00:00Z",
    ...overrides,
  };
}

describe("computeFindings", () => {
  it("only flags expired user-managed service account keys", () => {
    const findings = computeFindings(
      makeSnapshot({
        serviceAccounts: [
          {
            name: "projects/p/serviceAccounts/system-sa@p.iam.gserviceaccount.com",
            projectId: "p",
            uniqueId: "1",
            email: "system-sa@p.iam.gserviceaccount.com",
            displayName: "System SA",
            disabled: false,
            roles: [],
            keys: [
              {
                name: "projects/p/serviceAccounts/system-sa@p.iam.gserviceaccount.com/keys/1",
                keyType: "SYSTEM_MANAGED",
                validAfterTime: "2026-01-01T00:00:00Z",
                validBeforeTime: "2026-01-02T00:00:00Z",
              },
            ],
          },
          {
            name: "projects/p/serviceAccounts/user-sa@p.iam.gserviceaccount.com",
            projectId: "p",
            uniqueId: "2",
            email: "user-sa@p.iam.gserviceaccount.com",
            displayName: "User SA",
            disabled: false,
            roles: [],
            keys: [
              {
                name: "projects/p/serviceAccounts/user-sa@p.iam.gserviceaccount.com/keys/2",
                keyType: "USER_MANAGED",
                validAfterTime: "2025-01-01T00:00:00Z",
                validBeforeTime: "2025-01-02T00:00:00Z",
              },
            ],
          },
        ],
      })
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("expired_sa_key:p:user-sa@p.iam.gserviceaccount.com");
    expect(findings[0].resourceName).toBe("user-sa@p.iam.gserviceaccount.com");
  });
});
