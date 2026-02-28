import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel serverless functions have a 60s default timeout on Pro
  // Hobby plan: 10s — keep GCP calls fast with caching
  serverExternalPackages: ["googleapis"],
};

export default nextConfig;
