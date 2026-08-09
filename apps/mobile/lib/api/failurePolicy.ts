/** Pure failure classification for auth refresh, bootstrap and durable GET cache. */

export type ApiFailureLike = {
  status?: unknown;
  code?: unknown;
};

export function getFailureStatus(error: unknown): number | undefined {
  if (error == null || typeof error !== 'object') return undefined;
  const status = (error as ApiFailureLike).status;
  return typeof status === 'number' ? status : undefined;
}

/**
 * Only an authoritative auth rejection proves that a persisted session is dead.
 * Transport errors, rate limits and 5xx responses must preserve credentials so
 * a temporary outage cannot log the user out.
 */
export function isAuthoritativeRefreshRejection(status: number): boolean {
  return status === 401 || status === 403;
}

export function isAuthoritativeSessionFailure(error: unknown): boolean {
  const status = getFailureStatus(error);
  return status !== undefined && isAuthoritativeRefreshRejection(status);
}

/**
 * A stale durable GET is safer than an empty/error screen only for transient
 * failures. Client/auth errors (4xx except 429) stay authoritative and must not
 * be hidden by old data.
 */
export function shouldFallbackToDurableCache(error: unknown): boolean {
  if (error == null || typeof error !== 'object') return true;

  const failure = error as ApiFailureLike;
  const status = getFailureStatus(error);
  const code = typeof failure.code === 'string' ? failure.code : undefined;

  // Numeric HTTP status is authoritative when present. status=0 is the local
  // transport sentinel used by the client for network/timeout failures.
  if (status === 0) return true;
  if (status === 429) return true;
  if (typeof status === 'number') return status >= 500;

  if (code === 'network' || code === 'timeout' || code === 'rate_limit') return true;

  // Unknown runtime errors keep the previous best-effort cache behaviour.
  return true;
}
