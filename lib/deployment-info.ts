function shortSha(value: string | undefined): string {
  const sha = (value ?? "").trim();
  return sha ? sha.slice(0, 7) : "local";
}

function clean(value: string | undefined): string {
  return (value ?? "").trim() || "unknown";
}

/**
 * Exact source commit of this running build.
 * - Vercel sets VERCEL_GIT_COMMIT_SHA automatically.
 * - Cloud Build bakes NEXT_PUBLIC_GIT_SHA via the Dockerfile GIT_SHA build arg
 *   (see cloudbuild.yaml / build-image.sh).
 */
export function getBuildSha(): string | null {
  const sha = (process.env.NEXT_PUBLIC_GIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || "").trim();
  return sha ? sha.slice(0, 7) : null;
}

export function getDeploymentInfo() {
  return {
    branch: clean(process.env.VERCEL_GIT_COMMIT_REF),
    commitSha: shortSha(process.env.NEXT_PUBLIC_GIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA),
    deploymentUrl: clean(
      process.env.VERCEL_BRANCH_URL ||
      process.env.VERCEL_PROJECT_PRODUCTION_URL ||
      process.env.VERCEL_URL
    ),
  };
}
