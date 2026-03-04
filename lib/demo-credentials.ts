/**
 * Browser-only (sessionStorage) credential store for demo users.
 * Credentials are never sent to or stored on the server — they are only
 * transmitted over HTTPS in each scan request body and discarded immediately
 * after the scan completes server-side.
 *
 * sessionStorage is automatically cleared when the browser tab is closed.
 */

export type DemoGcpCredentials = { serviceAccountKey: string };
export type DemoAwsCredentials = { accessKeyId: string; secretAccessKey: string; region: string };
export type DemoCredentials = { gcp?: DemoGcpCredentials; aws?: DemoAwsCredentials };

const STORAGE_KEY = "watchmen_demo_creds";

function read(): DemoCredentials {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "{}") as DemoCredentials;
  } catch {
    return {};
  }
}

function write(data: DemoCredentials): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function getDemoCredentials(): DemoCredentials {
  return read();
}

export function setDemoGcpCredentials(creds: DemoGcpCredentials): void {
  write({ ...read(), gcp: creds });
}

export function setDemoAwsCredentials(creds: DemoAwsCredentials): void {
  write({ ...read(), aws: creds });
}

export function clearDemoCredentials(provider?: "gcp" | "aws"): void {
  if (!provider) {
    sessionStorage.removeItem(STORAGE_KEY);
    return;
  }
  const data = read();
  delete data[provider];
  write(data);
}
