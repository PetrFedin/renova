/** Централизованный лог критических сбоев (без silent swallow). */
type Extra = Record<string, unknown> | undefined;

export function reportError(scope: string, error: unknown, extra?: Extra): void {
  const message = error instanceof Error ? error.message : String(error);
  const payload = { scope, message, extra, at: new Date().toISOString() };
  if (__DEV__) {
    console.warn(`[reportError] ${scope}`, error, extra || '');
  }
  // Optional Sentry when DSN + SDK available (no hard dependency)
  try {
    const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
    if (!dsn) return;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require('sentry-expo');
    Sentry.Native?.captureException?.(error instanceof Error ? error : new Error(message), {
      tags: { scope },
      extra: payload,
    });
  } catch {
    /* SDK not installed — console only */
  }
}
