type LogMeta = Record<string, unknown>;

export function isTerraformVerboseEnabled(): boolean {
  return process.env.WATCHMEN_TERRAFORM_VERBOSE === "1" || process.env.WATCHMEN_TERRAFORM_VERBOSE === "true";
}

function serializeError(error: unknown): LogMeta {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return { error };
}

function formatMeta(meta?: LogMeta): string {
  if (!meta || Object.keys(meta).length === 0) return "";
  try {
    return ` ${JSON.stringify(meta)}`;
  } catch {
    return " [unserializable meta]";
  }
}

function prefix(scope: string): string {
  return `[${new Date().toISOString()}] [terraform:${scope}]`;
}

export function logTerraformInfo(scope: string, message: string, meta?: LogMeta): void {
  console.info(`${prefix(scope)} ${message}${formatMeta(meta)}`);
}

export function logTerraformWarn(scope: string, message: string, meta?: LogMeta): void {
  console.warn(`${prefix(scope)} ${message}${formatMeta(meta)}`);
}

export function logTerraformError(scope: string, message: string, error: unknown, meta?: LogMeta): void {
  console.error(`${prefix(scope)} ${message}${formatMeta({ ...meta, ...serializeError(error) })}`);
}
