function shortSha(value: string | undefined): string {
  const sha = (value ?? "").trim();
  return sha ? sha.slice(0, 7) : "local";
}

function clean(value: string | undefined): string {
  return (value ?? "").trim() || "unknown";
}

export function getDeploymentInfo() {
  return {
    branch: clean(process.env.VERCEL_GIT_COMMIT_REF),
    commitSha: shortSha(process.env.VERCEL_GIT_COMMIT_SHA),
    deploymentUrl: clean(
      process.env.VERCEL_BRANCH_URL ||
      process.env.VERCEL_PROJECT_PRODUCTION_URL ||
      process.env.VERCEL_URL
    ),
  };
}
