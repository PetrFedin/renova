/**
 * Optional Sentry bootstrap — only when EXPO_PUBLIC_SENTRY_DSN is set.
 * No hard dependency: dynamic require of @sentry/react-native or sentry-expo.
 * Production without DSN is enforced by envSchema (or explicit approved exception).
 */
import { sanitizeSentryEvent } from './sentrySanitize';

function appRelease(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const appJson = require('../app.json');
    const v = appJson?.expo?.version || '0.0.0';
    return `renova-mobile@${v}`;
  } catch {
    return 'renova-mobile@unknown';
  }
}

export function initSentry(): void {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN?.trim();
  if (!dsn) return;

  const environment =
    process.env.EXPO_PUBLIC_APP_ENV ||
    process.env.EXPO_PUBLIC_ENV ||
    process.env.NODE_ENV ||
    'development';
  const isProd = String(environment).toLowerCase() === 'production';

  const shared = {
    dsn,
    tracesSampleRate: isProd ? 0.05 : 0.1,
    environment,
    release: appRelease(),
    debug: false,
    beforeSend(event: Record<string, unknown>) {
      return sanitizeSentryEvent(event);
    },
  };

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const SentryRN = require('@sentry/react-native');
    if (SentryRN?.init) {
      SentryRN.init({
        ...shared,
        enableAutoSessionTracking: true,
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
      ...shared,
      // Never enable verbose Expo development transport in production builds
      enableInExpoDevelopment: !isProd && __DEV__,
    });
  } catch {
    if (__DEV__) {
      console.warn('[sentryInit] DSN set but no Sentry SDK installed');
    }
  }
}
