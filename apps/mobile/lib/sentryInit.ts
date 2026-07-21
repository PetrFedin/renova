/**
 * Optional Sentry bootstrap — only when EXPO_PUBLIC_SENTRY_DSN is set.
 * No hard dependency: dynamic require of @sentry/react-native or sentry-expo.
 */
export function initSentry(): void {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN?.trim();
  if (!dsn) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const SentryRN = require('@sentry/react-native');
    if (SentryRN?.init) {
      SentryRN.init({
        dsn,
        tracesSampleRate: 0.1,
        enableAutoSessionTracking: true,
        environment: process.env.EXPO_PUBLIC_ENV || process.env.NODE_ENV || 'development',
      });
      return;
    }
  } catch {
    /* SDK not installed */
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require('sentry-expo');
    Sentry.init?.({
      dsn,
      enableInExpoDevelopment: true,
      tracesSampleRate: 0.1,
    });
  } catch {
    if (__DEV__) {
      console.warn('[sentryInit] DSN set but no Sentry SDK installed');
    }
  }
}
