#!/usr/bin/env node

import pg from "pg";

const { Client } = pg;

const postgresUrl = process.env.POSTGRES_URL;
if (!postgresUrl) {
  console.error("POSTGRES_URL is required, for example postgresql://pipeline:local@127.0.0.1:5432/watchmen");
  process.exit(1);
}

const userEmail = process.env.WATCHMEN_LOCAL_EMAIL || "local@watchmen.dev";
const batchId = process.env.WATCHMEN_GEO_SEED_ID || `geo-${Date.now()}`;
const now = Date.now();

const locations = [
  { city: "Petach Tikva", region: "Central District", country: "Israel", lat: 32.084, lon: 34.8878, ip: null },
  { city: "New York", region: "New York", country: "United States", lat: 40.7128, lon: -74.006, ip: "8.8.8.8" },
  { city: "San Francisco", region: "California", country: "United States", lat: 37.7749, lon: -122.4194, ip: "4.2.2.1" },
  { city: "Mexico City", region: "Mexico City", country: "Mexico", lat: 19.4326, lon: -99.1332, ip: "189.247.72.10" },
  { city: "Toronto", region: "Ontario", country: "Canada", lat: 43.6532, lon: -79.3832, ip: "99.79.169.10" },
  { city: "London", region: "England", country: "United Kingdom", lat: 51.5074, lon: -0.1278, ip: "1.1.1.1" },
  { city: "Paris", region: "Ile-de-France", country: "France", lat: 48.8566, lon: 2.3522, ip: "51.158.66.10" },
  { city: "Berlin", region: "Berlin", country: "Germany", lat: 52.52, lon: 13.405, ip: "80.158.67.40" },
  { city: "Lagos", region: "Lagos", country: "Nigeria", lat: 6.5244, lon: 3.3792, ip: "102.89.23.11" },
  { city: "Cape Town", region: "Western Cape", country: "South Africa", lat: -33.9249, lon: 18.4241, ip: "196.25.1.1" },
  { city: "Tokyo", region: "Tokyo", country: "Japan", lat: 35.6762, lon: 139.6503, ip: "203.0.113.10" },
  { city: "Seoul", region: "Seoul", country: "South Korea", lat: 37.5665, lon: 126.978, ip: "121.78.30.1" },
  { city: "Singapore", region: "Central Region", country: "Singapore", lat: 1.3521, lon: 103.8198, ip: "103.6.148.10" },
  { city: "Sao Paulo", region: "Sao Paulo", country: "Brazil", lat: -23.5505, lon: -46.6333, ip: "198.51.100.22" },
  { city: "Buenos Aires", region: "Buenos Aires", country: "Argentina", lat: -34.6037, lon: -58.3816, ip: "181.30.128.1" },
  { city: "Sydney", region: "New South Wales", country: "Australia", lat: -33.8688, lon: 151.2093, ip: "192.0.2.44" },
  { city: "Dubai", region: "Dubai", country: "United Arab Emirates", lat: 25.2048, lon: 55.2708, ip: "9.9.9.9" },
  { city: "Mumbai", region: "Maharashtra", country: "India", lat: 19.076, lon: 72.8777, ip: "208.67.222.222" },
  { city: "Bangkok", region: "Bangkok", country: "Thailand", lat: 13.7563, lon: 100.5018, ip: "203.146.127.115" },
  { city: "Ho Chi Minh City", region: "Ho Chi Minh City", country: "Vietnam", lat: 10.8231, lon: 106.6297, ip: "203.162.4.190" },
];

const paths = [
  { method: "GET", path: "/", status: 200, decision: "allow", matchedRuleIds: [], contentType: "text/html", bodySize: 0 },
  { method: "GET", path: "/api/products?category=sensors", status: 200, decision: "allow", matchedRuleIds: [], contentType: "application/json", bodySize: 0 },
  { method: "POST", path: "/api/cart", status: 201, decision: "allow", matchedRuleIds: [], contentType: "application/json", bodySize: 512, bodySample: "{\"sku\":\"sensor-pro\",\"quantity\":1}" },
  { method: "POST", path: "/api/checkout", status: 202, decision: "allow", matchedRuleIds: [], contentType: "application/json", bodySize: 840, bodySample: "{\"payment\":\"tokenized\",\"shipping\":\"standard\"}" },
  { method: "GET", path: "/api/not-found", status: 404, decision: "allow", matchedRuleIds: [], contentType: "application/json", bodySize: 0 },
  { method: "POST", path: "/api/upload/audio", status: 202, decision: "flagged", matchedRuleIds: ["default-content-audio-wav"], contentType: "audio/wav", bodySize: 284000, bodySample: "RIFF....WAVEfmt" },
  { method: "POST", path: "/api/forms/contact", status: 200, decision: "flagged", matchedRuleIds: ["default-body-red"], contentType: "application/json", bodySize: 640, bodySample: "{\"message\":\"red team validation marker\"}" },
  { method: "GET", path: "/api/admin", status: 403, decision: "would_block", matchedRuleIds: ["default-path-admin"], contentType: "application/json", bodySize: 0 },
  { method: "POST", path: "/api/admin/login", status: 403, decision: "would_block", matchedRuleIds: ["default-path-admin"], contentType: "application/json", bodySize: 724, bodySample: "{\"username\":\"admin\",\"password\":\"guess\"}" },
  { method: "DELETE", path: "/api/admin/users/42", status: 403, decision: "would_block", matchedRuleIds: ["default-path-admin", "default-method-delete"], contentType: "application/json", bodySize: 128, bodySample: "{\"reason\":\"cleanup\"}" },
  { method: "PATCH", path: "/api/admin/payments/authorize", status: 403, decision: "would_block", matchedRuleIds: ["default-path-admin"], contentType: "application/json", bodySize: 980, bodySample: "{\"limit\":999999,\"role\":\"operator\"}" },
  { method: "GET", path: "/admin", status: 403, decision: "would_block", matchedRuleIds: ["default-path-admin"], contentType: "text/html", bodySize: 0 },
  { method: "POST", path: "/admin/export", status: 403, decision: "would_block", matchedRuleIds: ["default-path-admin"], contentType: "application/json", bodySize: 4096, bodySample: "{\"dataset\":\"customers\",\"format\":\"csv\"}" },
  { method: "DELETE", path: "/admin/session", status: 403, decision: "would_block", matchedRuleIds: ["default-path-admin", "default-method-delete"], contentType: "application/json", bodySize: 220, bodySample: "{\"session\":\"all\"}" },
  { method: "PUT", path: "/api/admin/config", status: 403, decision: "would_block", matchedRuleIds: ["default-path-admin"], contentType: "application/json", bodySize: 1480, bodySample: "{\"featureFlags\":{\"bypassAuth\":true}}" },
  { method: "GET", path: "/.env", status: 404, decision: "flagged", matchedRuleIds: ["default-public-source"], contentType: "text/plain", bodySize: 0 },
  { method: "GET", path: "/wp-admin", status: 404, decision: "flagged", matchedRuleIds: ["default-public-source"], contentType: "text/html", bodySize: 0 },
  { method: "POST", path: "/graphql", status: 400, decision: "flagged", matchedRuleIds: ["default-public-source"], contentType: "application/json", bodySize: 2048, bodySample: "{\"query\":\"mutation IntrospectionProbe { __schema { types { name } } }\"}" },
  { method: "POST", path: "/api/payments/refund", status: 429, decision: "flagged", matchedRuleIds: ["default-public-source"], contentType: "application/json", bodySize: 780, bodySample: "{\"amount\":9999,\"currency\":\"USD\"}" },
  { method: "GET", path: "/api/search?q=%27%20OR%201%3D1--", status: 400, decision: "flagged", matchedRuleIds: ["default-public-source"], contentType: "application/json", bodySize: 0 },
];

function eventTimestamp(locationIndex, pathIndex) {
  const offsetMs = ((locationIndex * paths.length) + pathIndex) * 650;
  return new Date(now - offsetMs).toISOString();
}

function sourceIpClass(ip) {
  return ip ? "public" : "unknown";
}

const client = new Client({ connectionString: postgresUrl });

try {
  await client.connect();
  let inserted = 0;

  for (const [locationIndex, location] of locations.entries()) {
    for (const [pathIndex, request] of paths.entries()) {
      const id = `seed-${batchId}-${location.city.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${pathIndex}`;
      const ts = eventTimestamp(locationIndex, pathIndex);
      const reasons = request.decision === "would_block"
        ? ["Seeded geo request matched red-map demo enforcement candidate"]
        : request.decision === "flagged"
          ? ["Seeded geo request matched detect-only suspicious traffic policy"]
        : [];

      await client.query(
        `
          INSERT INTO runtime_request_events (
            user_email,
            id,
            ts,
            source_ip,
            source_ip_class,
            source_geo_lat,
            source_geo_lon,
            source_geo_region,
            source_geo_city,
            source_geo_country,
            method,
            path,
            content_type,
            body_size,
            body_sample,
            status_code,
            destination_service,
            decision,
            matched_rule_ids,
            reasons,
            highest_severity
          )
          VALUES (
            $1, $2, $3, $4, $5,
            $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15,
            $16, $17, $18,
            $19::jsonb, $20::jsonb, $21
          )
          ON CONFLICT (user_email, id) DO UPDATE SET
            ts = EXCLUDED.ts,
            source_ip = EXCLUDED.source_ip,
            source_ip_class = EXCLUDED.source_ip_class,
            source_geo_lat = EXCLUDED.source_geo_lat,
            source_geo_lon = EXCLUDED.source_geo_lon,
            source_geo_region = EXCLUDED.source_geo_region,
            source_geo_city = EXCLUDED.source_geo_city,
            source_geo_country = EXCLUDED.source_geo_country,
            method = EXCLUDED.method,
            path = EXCLUDED.path,
            content_type = EXCLUDED.content_type,
            body_size = EXCLUDED.body_size,
            body_sample = EXCLUDED.body_sample,
            status_code = EXCLUDED.status_code,
            destination_service = EXCLUDED.destination_service,
            decision = EXCLUDED.decision,
            matched_rule_ids = EXCLUDED.matched_rule_ids,
            reasons = EXCLUDED.reasons,
            highest_severity = EXCLUDED.highest_severity
        `,
        [
          userEmail,
          id,
          ts,
          location.ip,
          sourceIpClass(location.ip),
          location.lat,
          location.lon,
          location.region,
          location.city,
          location.country,
          request.method,
          `${request.path}${request.path.includes("?") ? "&" : "?"}demo_trace_id=${batchId}`,
          request.contentType ?? null,
          request.bodySize ?? null,
          request.bodySample ?? null,
          request.status,
          "geo-seed",
          request.decision,
          JSON.stringify(request.matchedRuleIds),
          JSON.stringify(reasons),
          request.decision === "would_block" ? "critical" : request.decision === "flagged" ? "medium" : null,
        ],
      );
      inserted += 1;
    }
  }

  console.log(`Seeded ${inserted} geo runtime request events for ${userEmail} with batch ${batchId}.`);
} finally {
  await client.end();
}
