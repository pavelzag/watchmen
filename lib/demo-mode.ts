const DEV_DEMO_HOSTS = new Set([
  "watchmen-dev-kappa.vercel.app",
]);

function normalizeHost(value: string | undefined): string {
  return (value ?? "")
    .trim()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .toLowerCase();
}

export function isDemoMode(): boolean {
  if (process.env.DEMO_MODE === "true") return true;

  const vercelHosts = [
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
  ].map(normalizeHost);

  return vercelHosts.some((host) => DEV_DEMO_HOSTS.has(host));
}
