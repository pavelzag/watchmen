export type AwsCredentials = {
  accessKeyId?: string;
  secretAccessKey?: string;
  region?: string;
};

/**
 * Returns AWS SDK client options, merging explicit credentials when provided.
 * Without creds, falls back to the default AWS credential chain (env vars, instance profile, etc.).
 */
export function getAwsClientOptions(region: string, creds?: AwsCredentials) {
  if (creds?.accessKeyId && creds?.secretAccessKey) {
    return {
      region,
      credentials: {
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
      },
    };
  }
  return { region };
}

export function useMockAwsData(forced?: boolean): boolean {
  if (forced !== undefined) return forced;
  return process.env.USE_MOCK_AWS_DATA === "true";
}

/**
 * Returns configured AWS regions from the AWS_REGIONS env var (comma-separated).
 * Defaults to us-east-1 if unset.
 */
export function getAwsRegions(): string[] {
  return (process.env.AWS_REGIONS ?? "us-east-1")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
}

/**
 * Logs a per-region/service fetch failure.
 * Permission errors are expected for cross-account configs.
 */
export function logAwsWarning(fetcher: string, context: string, reason: unknown) {
  const msg = (reason instanceof Error ? reason.message : String(reason)).split("\n")[0];
  const isExpected =
    msg.includes("AccessDenied") ||
    msg.includes("is not authorized") ||
    msg.includes("NoCredentialProviders") ||
    msg.includes("UnrecognizedClientException");
  if (isExpected) {
    console.info(`[aws/${fetcher}] skipping ${context}: ${msg}`);
  } else {
    console.warn(`[aws/${fetcher}] ${context} warning:`, reason);
  }
}
