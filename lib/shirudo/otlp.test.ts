import { createHash } from "crypto";
import {
  decodeCondBits,
  parseOtlpLogsPayload,
  parseOtlpMetricsPayload,
  parseShirudoQuote,
} from "@/lib/shirudo/otlp";

describe("lib/shirudo/otlp", () => {
  it("parses shirudo.quote and computes 000b + sha256(ak) node identifier", () => {
    const akBytes = Buffer.from("mock-tpmt-public-key-bytes");
    const akB64 = akBytes.toString("base64");
    const expectedAkName = `000b${createHash("sha256").update(akBytes).digest("hex")}`;

    const parsed = parseShirudoQuote(`attest=AAAA;sig=BBBB;ak=${akB64}`);
    expect(parsed.present).toBe(true);
    expect(parsed.hasAttest).toBe(true);
    expect(parsed.hasSig).toBe(true);
    expect(parsed.hasAk).toBe(true);
    expect(parsed.akName).toBe(expectedAkName);

    const missing = parseShirudoQuote(undefined);
    expect(missing.present).toBe(false);
    expect(missing.akName).toBeNull();
  });

  it("decodes the 7 Shirudo condition bit pairs", () => {
    // 5461 = 0b01_01_01_01_01_01_01 (all 7 conditions OK)
    const allOk = decodeCondBits(5461);
    expect(allOk).toHaveLength(7);
    expect(allOk.every((c) => c.status === "ok")).toBe(true);

    // ChainIntact (index 2, bits 4..5) set to 11 (alert), LsmAttached (index 0) set to 10 (warn)
    const cond = (0b11 << 4) | 0b10;
    const decoded = decodeCondBits(cond);
    expect(decoded.find((c) => c.name === "LsmAttached")?.status).toBe("warn");
    expect(decoded.find((c) => c.name === "ChainIntact")?.status).toBe("alert");
  });

  it("parses OTLP JSON keepalive and BPF map snapshot logs", () => {
    const akB64 = Buffer.from("test-ak").toString("base64");
    const keepaliveBody = JSON.stringify({
      schema: "shirudo.keepalive/1",
      boot_id: "82639935-1127-4dab-91b5-f818eabc7f13",
      kernel_release: "7.4.0-bpf-next+",
      verdict: "ok",
      cond: 5461,
      flags: 0,
      tamper: [0, 1, 0],
      integrity: [0, 0],
      tree_id: "fleet-prod",
      last_seq: 4,
      count: 2,
    });

    const payload = {
      resourceLogs: [
        {
          resource: {
            attributes: [
              { key: "service.name", value: { stringValue: "shirudo" } },
              { key: "service.version", value: { stringValue: "58d3fa7" } },
              { key: "host.name", value: { stringValue: "prod-node-1" } },
            ],
          },
          scopeLogs: [
            {
              scope: { name: "shirudo.keepalive" },
              logRecords: [
                {
                  timeUnixNano: "1764000000000000000",
                  eventName: "shirudo.keepalive",
                  body: { stringValue: keepaliveBody },
                  attributes: [
                    { key: "shirudo.quote", value: { stringValue: `attest=AQID;sig=BAUG;ak=${akB64}` } },
                  ],
                },
              ],
            },
            {
              scope: { name: "shirudo.upatch.maps" },
              logRecords: [
                {
                  timeUnixNano: "1764000005000000000",
                  eventName: "shirudo.bpf.map.snapshot",
                  body: {
                    stringValue: JSON.stringify({
                      upatch: "xz-lzma-guard",
                      map: "blocked_hits",
                      advisory: "CVE-2024-3094",
                      hits: 7,
                    }),
                  },
                },
              ],
            },
          ],
        },
      ],
    };

    const parsed = parseOtlpLogsPayload(payload);
    expect(parsed.totalRecords).toBe(2);
    expect(parsed.keepalives).toHaveLength(1);
    expect(parsed.keepalives[0].hostName).toBe("prod-node-1");
    expect(parsed.keepalives[0].quotePresent).toBe(true);
    expect(parsed.keepalives[0].quoteVerified).toBe(false);
    expect(parsed.keepalives[0].quoteVerificationError).toBeTruthy();
    expect(parsed.keepalives[0].tamperTotal).toBe(1);
    expect(parsed.keepalives[0].body.verdict).toBe("ok");

    expect(parsed.mapSnapshots).toHaveLength(1);
    expect(parsed.mapSnapshots[0].upatchId).toBe("xz-lzma-guard");
    expect(parsed.mapSnapshots[0].advisoryId).toBe("CVE-2024-3094");
    expect(parsed.mapSnapshots[0].hitCount).toBe(7);
  });

  it("parses OTLP metrics shield hit data points", () => {
    const metricsPayload = {
      resourceMetrics: [
        {
          resource: {
            attributes: [{ key: "host.name", value: { stringValue: "prod-node-2" } }],
          },
          scopeMetrics: [
            {
              metrics: [
                {
                  name: "shirudo_shield_hits",
                  sum: {
                    dataPoints: [
                      {
                        asInt: "12",
                        timeUnixNano: "1764000010000000000",
                        attributes: [
                          { key: "shirudo.upatch", value: { stringValue: "http2-rst-limit" } },
                          { key: "cve", value: { stringValue: "cve-2023-44487" } },
                        ],
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    };

    const parsed = parseOtlpMetricsPayload(metricsPayload);
    expect(parsed.totalDataPoints).toBe(1);
    expect(parsed.hits).toHaveLength(1);
    expect(parsed.hits[0].upatchId).toBe("http2-rst-limit");
    expect(parsed.hits[0].advisoryId).toBe("CVE-2023-44487");
    expect(parsed.hits[0].hitCount).toBe(12);
  });
});
