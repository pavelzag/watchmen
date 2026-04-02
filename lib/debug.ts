type DebugMeta = Record<string, unknown>;

function envFlagEnabled(value: string | undefined): boolean {
  return value === "1" || value === "true";
}

export function isDebugEnabled(): boolean {
  return envFlagEnabled(process.env.WATCHMEN_DEBUG) || envFlagEnabled(process.env.NEXT_PUBLIC_WATCHMEN_DEBUG);
}

function formatMeta(meta?: DebugMeta): string {
  if (!meta || Object.keys(meta).length === 0) return "";
  try {
    return ` ${JSON.stringify(meta)}`;
  } catch {
    return " [unserializable meta]";
  }
}

function debugPrefix(scope: string): string {
  return `[${new Date().toISOString()}] [debug:${scope}]`;
}

function serializeError(error: unknown): DebugMeta {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return { error };
}

export function debugLog(scope: string, message: string, meta?: DebugMeta): void {
  if (!isDebugEnabled()) return;
  console.info(`${debugPrefix(scope)} ${message}${formatMeta(meta)}`);
}

export function debugWarn(scope: string, message: string, meta?: DebugMeta): void {
  if (!isDebugEnabled()) return;
  console.warn(`${debugPrefix(scope)} ${message}${formatMeta(meta)}`);
}

export function debugError(scope: string, message: string, error: unknown, meta?: DebugMeta): void {
  if (!isDebugEnabled()) return;
  console.error(`${debugPrefix(scope)} ${message}${formatMeta({ ...meta, ...serializeError(error) })}`);
}

export async function withDebugTiming<T>(
  scope: string,
  action: string,
  meta: DebugMeta,
  fn: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now();
  debugLog(scope, `${action}:start`, meta);
  try {
    const result = await fn();
    debugLog(scope, `${action}:done`, { ...meta, durationMs: Date.now() - startedAt });
    return result;
  } catch (error) {
    debugError(scope, `${action}:failed`, error, { ...meta, durationMs: Date.now() - startedAt });
    throw error;
  }
}
