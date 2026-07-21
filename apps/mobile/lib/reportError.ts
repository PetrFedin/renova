/** Централизованный лог критических сбоев (без silent swallow). */
type Extra = Record<string, unknown> | undefined;

function captureSentry(error: unknown, message: string, scope: string, payload: Record<string, unknown>): void {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  const err = error instanceof Error ? error : new Error(message);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const SentryRN = require('@sentry/react-native');
    if (SentryRN?.captureException) {
      SentryRN.captureException(err, { tags: { scope }, extra: payload });
      return;
    }
  } catch {
    /* not installed */
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require('sentry-expo');
    Sentry.Native?.captureException?.(err, { tags: { scope }, extra: payload });
  } catch {
    /* SDK not installed — console only */
  }
}

export function reportError(scope: string, error: unknown, extra?: Extra): void {
  const message = error instanceof Error ? error.message : String(error);
  const payload = { scope, message, extra, at: new Date().toISOString() };
  if (__DEV__) {
    console.warn(`[reportError] ${scope}`, error, extra || '');
  }
  captureSentry(error, message, scope, payload);
}

/** Для `.catch(reportCatch('scope'))` вместо silent `.catch(() => {})`. */
export function reportCatch(scope: string, extra?: Extra): (error: unknown) => void {
  return (error: unknown) => reportError(scope, error, extra);
}
