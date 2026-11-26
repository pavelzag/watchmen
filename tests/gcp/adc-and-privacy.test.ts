/** @jest-environment node */

import { initGoogleAuthForRequest, isGcpAdcEnabled } from "@/lib/gcp/client";
import { computeFindings } from "@/lib/findings";
import type { GcpSnapshot } from "@/lib/gcp/types";
import {
  redactRawHttpPayload,
  redactSensitivePath,
  sanitizeRemoteIp,
  truncateIpAddress,
} from "@/lib/privacy";
import { setPubsubTokenVerifierForTests, verifyPubsubPushRequest } from "@/lib/pubsub-auth";
import { generateGcpTraceSourceBundle, DEFAULT_GCP_TRACE_SOURCE_CONFIG } from "@/lib/trace-source";

describe("keyless GCP ADC auth resolution", () => {
  const originalAdc = process.env.GCP_USE_ADC;

  afterEach(() => {
    if (originalAdc === undefined) delete process.env.GCP_USE_ADC;
    else process.env.GCP_USE_ADC = originalAdc;
  });

  it("returns null when no credentials are configured and GCP_USE_ADC is disabled", () => {
    delete process.env.GCP_USE_ADC;
    expect(isGcpAdcEnabled()).toBe(false);
    expect(initGoogleAuthForRequest({})).toBeNull();
  });

  it("uses ADC when GCP_USE_ADC=true and no JSON key or OAuth token is provided", () => {
    process.env.GCP_USE_ADC = "true";
    expect(isGcpAdcEnabled()).toBe(true);
    expect(initGoogleAuthForRequest({})).toBe("adc");
  });

  it("prefers ADC over login-only OAuth accessToken when GCP_USE_ADC=true", () => {
    process.env.GCP_USE_ADC = "true";
    expect(initGoogleAuthForRequest({ accessToken: "openid-profile-only-token" })).toBe("adc");
  });
});

describe("Pub/Sub OIDC verification", () => {
  const originalRequire = process.env.GCP_PUBSUB_REQUIRE_OIDC;
  const originalEmail = process.env.GCP_PUBSUB_PUSH_EMAIL;
  const originalAudience = process.env.GCP_PUBSUB_PUSH_AUDIENCE;

  afterEach(() => {
    setPubsubTokenVerifierForTests(null);
    if (originalRequire === undefined) delete process.env.GCP_PUBSUB_REQUIRE_OIDC;
    else process.env.GCP_PUBSUB_REQUIRE_OIDC = originalRequire;
    if (originalEmail === undefined) delete process.env.GCP_PUBSUB_PUSH_EMAIL;
    else process.env.GCP_PUBSUB_PUSH_EMAIL = originalEmail;
    if (originalAudience === undefined) delete process.env.GCP_PUBSUB_PUSH_AUDIENCE;
    else process.env.GCP_PUBSUB_PUSH_AUDIENCE = originalAudience;
  });

  it("rejects missing bearer token when GCP_PUBSUB_REQUIRE_OIDC=true", async () => {
    process.env.GCP_PUBSUB_REQUIRE_OIDC = "true";
    const res = await verifyPubsubPushRequest({
      url: "https://watchmen.acme.dev/api/ingest/gcp/pubsub",
      headers: new Headers(),
    });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(401);
  });

  it("rejects mismatched push service account email with 403", async () => {
    process.env.GCP_PUBSUB_REQUIRE_OIDC = "true";
    process.env.GCP_PUBSUB_PUSH_EMAIL = "expected-push@acme-prod.iam.gserviceaccount.com";
    setPubsubTokenVerifierForTests(async () => ({
      email: "attacker@other-project.iam.gserviceaccount.com",
      email_verified: true,
    }));

    const res = await verifyPubsubPushRequest({
      url: "https://watchmen.acme.dev/api/ingest/gcp/pubsub",
      headers: new Headers({ Authorization: "Bearer fake-jwt" }),
    });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(403);
  });

  it("accepts verified token from configured push service account", async () => {
    process.env.GCP_PUBSUB_REQUIRE_OIDC = "true";
    process.env.GCP_PUBSUB_PUSH_EMAIL = "watchmen-live-trace-push@acme-prod.iam.gserviceaccount.com";
    process.env.GCP_PUBSUB_PUSH_AUDIENCE = "https://watchmen.acme.dev/api/ingest/gcp/pubsub";
    setPubsubTokenVerifierForTests(async (_token, audience) => {
      expect(audience).toEqual(["https://watchmen.acme.dev/api/ingest/gcp/pubsub"]);
      return {
        email: "watchmen-live-trace-push@acme-prod.iam.gserviceaccount.com",
        email_verified: true,
      };
    });

    const res = await verifyPubsubPushRequest({
      url: "https://watchmen.acme.dev/api/ingest/gcp/pubsub",
      headers: new Headers({ Authorization: "Bearer valid-jwt" }),
    });
    expect(res.ok).toBe(true);
    expect(res.email).toBe("watchmen-live-trace-push@acme-prod.iam.gserviceaccount.com");
  });
});

describe("privacy redaction & IP truncation", () => {
  const originalTruncate = process.env.WATCHMEN_TRUNCATE_IPS;
  const originalPrefixes = process.env.WATCHMEN_REDACT_PATH_PREFIXES;

  afterEach(() => {
    if (originalTruncate === undefined) delete process.env.WATCHMEN_TRUNCATE_IPS;
    else process.env.WATCHMEN_TRUNCATE_IPS = originalTruncate;
    if (originalPrefixes === undefined) delete process.env.WATCHMEN_REDACT_PATH_PREFIXES;
    else process.env.WATCHMEN_REDACT_PATH_PREFIXES = originalPrefixes;
  });

  it("redacts sensitive query params and configured token path prefixes", () => {
    process.env.WATCHMEN_REDACT_PATH_PREFIXES = "/sneakpeek/";
    const redacted = redactSensitivePath("/sneakpeek/secretToken256/home?token=abc&sig=xyz&lang=en");
    expect(redacted).toBe("/sneakpeek/REDACTED/home?token=REDACTED&sig=REDACTED&lang=en");
  });

  it("redacts Authorization and Cookie headers in raw HTTP payloads", () => {
    const raw = [
      "GET /admin?jwt=my-jwt&view=1 HTTP/1.1",
      "Host: cms.acme.dev",
      "Authorization: Bearer super-secret-token",
      "Cookie: session=abc123",
    ].join("\n");

    const redacted = redactRawHttpPayload(raw)!;
    expect(redacted).toContain("GET /admin?jwt=REDACTED&view=1 HTTP/1.1");
    expect(redacted).toContain("Authorization: REDACTED");
    expect(redacted).toContain("Cookie: REDACTED");
    expect(redacted).not.toContain("super-secret-token");
    expect(redacted).not.toContain("abc123");
  });

  it("truncates IPv4 to /24 and IPv6 to /48 when WATCHMEN_TRUNCATE_IPS=true", () => {
    expect(truncateIpAddress("203.0.113.42")).toBe("203.0.113.0");
    expect(truncateIpAddress("2001:db8:85a3:0:0:8a2e:370:7334")).toBe("2001:db8:85a3::");

    process.env.WATCHMEN_TRUNCATE_IPS = "true";
    expect(sanitizeRemoteIp("198.51.100.77")).toBe("198.51.100.0");
  });
});

describe("trace source Terraform exclusion filters", () => {
  it("renders Cloud Run exclusions into variables.tf when configured", () => {
    const bundle = generateGcpTraceSourceBundle({
      ...DEFAULT_GCP_TRACE_SOURCE_CONFIG,
      mode: "streaming",
      projectId: "acme-prod",
      region: "europe-west3",
      pushEndpoint: "https://watchmen.acme.dev/api/ingest/gcp/pubsub",
      excludeRequestLogServices: ["cms-prod-sneakpeek", "cms-prod-onboarding"],
    });

    const variablesTf = bundle.files.find((f) => f.name === "variables.tf")?.content ?? "";
    expect(variablesTf).toContain('resource.labels.service_name="cms-prod-sneakpeek"');
    expect(variablesTf).toContain('log_id("run.googleapis.com/requests")');
  });
});

describe("Cloud Run v2 Jobs findings", () => {
  it("detects leaked secrets in Cloud Run Job plain envVars", () => {
    const snapshot: GcpSnapshot = {
      snapshotId: "s1",
      fetchedAt: new Date().toISOString(),
      projects: [],
      serviceAccounts: [],
      storageBuckets: [],
      gkeClusters: [],
      vms: [],
      cloudRunServices: [],
      cloudRunJobs: [
        {
          name: "cms-dev-sneakpeek-job",
          projectId: "acme-dev",
          region: "europe-west3",
          status: "READY",
          iamPolicy: { bindings: [] },
          envVars: {
            DATABASE_URL: "postgresql://app:testpass1234@10.0.0.5:5432/watchmen",
          },
        },
      ],
      cloudSqlInstances: [],
      bigqueryDatasets: [],
      pubsubTopics: [],
      secrets: [],
      firewallRules: [],
      loadBalancers: [],
      scanWarnings: [],
    };

    const findings = computeFindings(snapshot);
    expect(findings.some((f) => f.id.startsWith("secret_in_env:cloudrun-job:acme-dev:cms-dev-sneakpeek-job:"))).toBe(true);
  });
});
