/** W53 / H0.1: staging|production клиент не должен ходить на localhost. */

export type ApiBaseGuardResult = {
  apiBase: string;
  appEnv: string;
  isLocalhost: boolean;
  blocked: boolean;
  warning: string | null;
};

export function isLocalhostApiUrl(url: string): boolean {
  const u = (url || '').toLowerCase();
  return (
    u.includes('://127.0.0.1') ||
    u.includes('://localhost') ||
    u.includes('://0.0.0.0') ||
    u.includes('://[::1]')
  );
}

export function evaluateApiBaseGuard(
  apiUrl: string | undefined,
  appEnv: string | undefined,
  fallback = 'http://127.0.0.1:8100',
): ApiBaseGuardResult {
  const apiBase = (apiUrl || fallback).trim();
  const env = (appEnv || 'development').trim().toLowerCase();
  const isLocal = isLocalhostApiUrl(apiBase);
  const releaseLike = env === 'staging' || env === 'production' || env === 'preview';
  const blocked = releaseLike && isLocal;
  let warning: string | null = null;
  if (blocked) {
    warning =
      'EXPO_PUBLIC_API_URL указывает на localhost, а APP_ENV=staging/production. ' +
      'TestFlight не достучится до API — задайте HTTPS staging URL.';
  } else if (isLocal && env === 'development') {
    warning = null;
  }
  return { apiBase, appEnv: env, isLocalhost: isLocal, blocked, warning };
}
