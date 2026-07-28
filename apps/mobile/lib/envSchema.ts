/**
 * Mobile public env schema — fail-fast for release builds.
 * Private secrets must NEVER appear in EXPO_PUBLIC_*.
 */
import { evaluateApiBaseGuard } from './apiBaseGuard';

export type MobileEnvInput = {
  EXPO_PUBLIC_API_URL?: string;
  EXPO_PUBLIC_APP_ENV?: string;
  EXPO_PUBLIC_DEMO?: string;
  EXPO_PUBLIC_SENTRY_DSN?: string;
  EXPO_PUBLIC_SENTRY_APPROVED_WITHOUT_DSN?: string;
  releaseVersion?: string;
};

export type MobileEnvResult = {
  ok: boolean;
  errors: string[];
  appEnv: string;
  apiUrl: string;
};

const FORBIDDEN_PUBLIC_NAMES = [
  'SECRET_KEY',
  'DATABASE_URL',
  'YOOKASSA_SECRET',
  'S3_SECRET_KEY',
  'MOY_NALOG_CLIENT_SECRET',
  'TWILIO_TOKEN',
  'KONTUR_API_KEY',
] as const;

function truthy(v: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes((v || '').trim().toLowerCase());
}

/** Validate public mobile env. Errors list variable names only. */
export function validateMobileEnv(
  input: MobileEnvInput = process.env as MobileEnvInput,
): MobileEnvResult {
  const errors: string[] = [];
  const appEnv = (input.EXPO_PUBLIC_APP_ENV || 'development').trim().toLowerCase();
  const apiUrl = (input.EXPO_PUBLIC_API_URL || '').trim();
  const releaseLike = appEnv === 'staging' || appEnv === 'production' || appEnv === 'preview';

  if (releaseLike) {
    if (!apiUrl) {
      errors.push('missing required variable: EXPO_PUBLIC_API_URL');
    } else {
      const guard = evaluateApiBaseGuard(apiUrl, appEnv);
      if (guard.blocked) {
        errors.push('missing required variable: EXPO_PUBLIC_API_URL');
      }
      if (!/^https:\/\//i.test(apiUrl)) {
        errors.push('missing required variable: EXPO_PUBLIC_API_URL');
      }
    }
    if (truthy(input.EXPO_PUBLIC_DEMO)) {
      errors.push('EXPO_PUBLIC_DEMO');
    }
    if (appEnv === 'production') {
      const dsn = (input.EXPO_PUBLIC_SENTRY_DSN || '').trim();
      if (!dsn && !truthy(input.EXPO_PUBLIC_SENTRY_APPROVED_WITHOUT_DSN)) {
        errors.push('missing required variable: EXPO_PUBLIC_SENTRY_DSN');
      }
    }
  }

  const uniq = [...new Set(errors)];
  return {
    ok: uniq.length === 0,
    errors: uniq,
    appEnv,
    apiUrl: apiUrl || 'http://127.0.0.1:8100',
  };
}

export function assertNoPrivateSecretsInPublicEnv(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): string[] {
  const bad: string[] = [];
  for (const name of FORBIDDEN_PUBLIC_NAMES) {
    const publicName = `EXPO_PUBLIC_${name}`;
    if ((env[publicName] || '').trim()) bad.push(publicName);
  }
  for (const key of Object.keys(env)) {
    if (!key.startsWith('EXPO_PUBLIC_')) continue;
    if (FORBIDDEN_PUBLIC_NAMES.some((n) => key === `EXPO_PUBLIC_${n}`)) continue;
    if (/SECRET|PASSWORD|PRIVATE_KEY|DATABASE_URL/i.test(key) && key !== 'EXPO_PUBLIC_SENTRY_DSN') {
      bad.push(key);
    }
  }
  return [...new Set(bad)];
}

export function assertMobileEnvOrThrow(input?: MobileEnvInput): void {
  const result = validateMobileEnv(input);
  const leaked = assertNoPrivateSecretsInPublicEnv(
    (input || process.env) as Record<string, string | undefined>,
  );
  if (leaked.length) {
    throw new Error(
      'Mobile env guard failed:\n- private secret must not use EXPO_PUBLIC_*: ' + leaked.join(', '),
    );
  }
  if (!result.ok) {
    throw new Error('Mobile env guard failed:\n- ' + result.errors.join('\n- '));
  }
}
