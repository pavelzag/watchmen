import { classifySourceIp, type RuntimeRequestEvent } from "@/lib/runtime-security";

type IpWhoIsResponse = {
  success?: boolean;
  latitude?: number;
  longitude?: number;
  city?: string;
  region?: string;
  country?: string;
  message?: string;
};

const cache = new Map<string, { expiresAt: number; geo: RuntimeRequestEvent["sourceGeo"] | null }>();
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 1500;

function geoEnabled() {
  return /^(1|true|yes)$/i.test(process.env.WATCHMEN_IP_GEO_ENABLED ?? "");
}

function ttlMs() {
  const value = Number(process.env.WATCHMEN_IP_GEO_CACHE_TTL_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TTL_MS;
}

function timeoutMs() {
  const value = Number(process.env.WATCHMEN_IP_GEO_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
}

function validCoordinates(lat: unknown, lon: unknown): { lat: number; lon: number } | null {
  if (
    typeof lat !== "number"
    || typeof lon !== "number"
    || !Number.isFinite(lat)
    || !Number.isFinite(lon)
    || lat < -90
    || lat > 90
    || lon < -180
    || lon > 180
  ) {
    return null;
  }
  return { lat, lon };
}

export async function enrichRuntimeEventGeo(event: RuntimeRequestEvent): Promise<RuntimeRequestEvent> {
  if (event.sourceGeo || !geoEnabled()) return event;

  const sourceIpClass = event.sourceIpClass ?? classifySourceIp(event.sourceIp);
  if (!event.sourceIp || sourceIpClass !== "public") return event;

  const geo = await lookupIpGeo(event.sourceIp);
  return geo ? { ...event, sourceGeo: geo } : event;
}

async function lookupIpGeo(ip: string): Promise<RuntimeRequestEvent["sourceGeo"] | null> {
  const cached = cache.get(ip);
  if (cached && cached.expiresAt > Date.now()) return cached.geo;

  const geo = await lookupIpWhoIs(ip).catch((error) => {
    console.warn("[runtime-security] IP geolocation lookup failed", {
      ip,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  });
  cache.set(ip, { geo, expiresAt: Date.now() + ttlMs() });
  return geo;
}

async function lookupIpWhoIs(ip: string): Promise<RuntimeRequestEvent["sourceGeo"] | null> {
  const response = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs()),
  });
  if (!response.ok) return null;

  const payload = await response.json() as IpWhoIsResponse;
  const coordinates = validCoordinates(payload.latitude, payload.longitude);
  if (payload.success === false || !coordinates) return null;

  return {
    lat: coordinates.lat,
    lon: coordinates.lon,
    city: payload.city,
    region: payload.region,
    country: payload.country,
  };
}
