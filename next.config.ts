import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel serverless functions have a 60s default timeout on Pro
  // Hobby plan: 10s — keep GCP calls fast with caching
  serverExternalPackages: ["googleapis"],
  // Standalone output bundles only what's needed — required for Docker/K8s/Cloud Run.
  // Vercel ignores this and uses its own build pipeline, so it's safe to always enable.
  output: "standalone",
};

export default nextConfig;
