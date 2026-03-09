/**
 * Sends fake traces to GCP Cloud Trace API v2.
 * Usage: node scripts/seed-traces.mjs
 * Requires: GOOGLE_APPLICATION_CREDENTIALS env var pointing to SA key JSON,
 *           or run after: export GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa-key.json
 */

import { GoogleAuth } from "google-auth-library";

const PROJECT_ID = "watchmen-test-488807";

const auth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/trace.append"],
});

function randomHex(len) {
  return Array.from({ length: len }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

function nowMinus(ms) {
  return new Date(Date.now() - ms).toISOString();
}

function makeSpanId() {
  return randomHex(16);
}

function buildTrace({ method, path, statusCode, durationMs, spans }) {
  const traceId = randomHex(32);
  const rootId = makeSpanId();
  const traceStart = Date.now() - durationMs - Math.floor(Math.random() * 30000);

  const builtSpans = [
    {
      name: `projects/${PROJECT_ID}/traces/${traceId}/spans/${rootId}`,
      spanId: rootId,
      displayName: { value: `${method} ${path}` },
      startTime: new Date(traceStart).toISOString(),
      endTime: new Date(traceStart + durationMs).toISOString(),
      attributes: {
        attributeMap: {
          "http.method": { stringValue: { value: method } },
          "http.url": { stringValue: { value: path } },
          "http.status_code": { intValue: statusCode.toString() },
        },
      },
      status: { code: statusCode >= 500 ? 2 : 0 },
    },
    ...spans.map(({ name, offsetMs, durationMs: spanDur, attrs }) => {
      const spanId = makeSpanId();
      return {
        name: `projects/${PROJECT_ID}/traces/${traceId}/spans/${spanId}`,
        spanId,
        parentSpanId: rootId,
        displayName: { value: name },
        startTime: new Date(traceStart + offsetMs).toISOString(),
        endTime: new Date(traceStart + offsetMs + spanDur).toISOString(),
        attributes: {
          attributeMap: Object.fromEntries(
            Object.entries(attrs || {}).map(([k, v]) => [k, { stringValue: { value: v } }])
          ),
        },
        status: { code: 0 },
      };
    }),
  ];

  return { spans: builtSpans };
}

const SCENARIOS = [
  {
    method: "GET", path: "/api/users", statusCode: 200, durationMs: 78,
    spans: [
      { name: "auth.validateToken", offsetMs: 2, durationMs: 8, attrs: {} },
      { name: "CloudSQL.query", offsetMs: 12, durationMs: 58, attrs: { "db.type": "postgresql" } },
    ],
  },
  {
    method: "POST", path: "/api/orders", statusCode: 201, durationMs: 210,
    spans: [
      { name: "auth.validateToken", offsetMs: 2, durationMs: 10, attrs: {} },
      { name: "validation.run", offsetMs: 14, durationMs: 6, attrs: {} },
      { name: "CloudSQL.insert", offsetMs: 22, durationMs: 145, attrs: { "db.type": "postgresql" } },
      { name: "PubSub.publish", offsetMs: 170, durationMs: 35, attrs: { "messaging.system": "pubsub" } },
    ],
  },
  {
    method: "GET", path: "/api/products", statusCode: 200, durationMs: 45,
    spans: [
      { name: "Redis.get", offsetMs: 2, durationMs: 4, attrs: { "cache.hit": "true" } },
    ],
  },
  {
    method: "POST", path: "/auth/login", statusCode: 200, durationMs: 830,
    spans: [
      { name: "CloudSQL.query (users)", offsetMs: 5, durationMs: 40, attrs: { "db.type": "postgresql" } },
      { name: "bcrypt.compare", offsetMs: 48, durationMs: 775, attrs: {} },
    ],
  },
  {
    method: "DELETE", path: "/api/sessions/xyz", statusCode: 204, durationMs: 18,
    spans: [
      { name: "auth.validateToken", offsetMs: 2, durationMs: 7, attrs: {} },
      { name: "Redis.del", offsetMs: 10, durationMs: 6, attrs: {} },
    ],
  },
  {
    method: "PUT", path: "/api/orders/9912", statusCode: 500, durationMs: 312,
    spans: [
      { name: "auth.validateToken", offsetMs: 2, durationMs: 9, attrs: {} },
      { name: "CloudSQL.query", offsetMs: 14, durationMs: 38, attrs: { "db.type": "postgresql" } },
      { name: "CloudSQL.update — timeout", offsetMs: 55, durationMs: 250, attrs: { "db.type": "postgresql", "error": "true" } },
    ],
  },
  {
    method: "GET", path: "/health", statusCode: 200, durationMs: 5,
    spans: [],
  },
  {
    method: "POST", path: "/api/payments", statusCode: 200, durationMs: 1840,
    spans: [
      { name: "auth.validateToken", offsetMs: 2, durationMs: 11, attrs: {} },
      { name: "stripe.charges.create", offsetMs: 15, durationMs: 1790, attrs: { "peer.service": "stripe.com" } },
      { name: "CloudSQL.insert (payment)", offsetMs: 1810, durationMs: 25, attrs: { "db.type": "postgresql" } },
    ],
  },
];

async function seedTraces(count = 20) {
  const client = await auth.getClient();
  const token = await client.getAccessToken();

  console.log(`Sending ${count} traces to project ${PROJECT_ID}...`);

  for (let i = 0; i < count; i++) {
    const scenario = SCENARIOS[i % SCENARIOS.length];
    const body = buildTrace(scenario);

    const res = await fetch(
      `https://cloudtrace.googleapis.com/v2/projects/${PROJECT_ID}/traces:batchWrite`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );

    if (res.ok) {
      console.log(`  ✓ ${scenario.method} ${scenario.path} (${scenario.durationMs}ms, ${scenario.statusCode})`);
    } else {
      const err = await res.text();
      console.error(`  ✗ ${scenario.method} ${scenario.path} → ${res.status}: ${err}`);
    }

    // small delay to spread timestamps
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log("\nDone! Wait ~30s then refresh the Live Traces tab.");
}

seedTraces(20).catch(console.error);
