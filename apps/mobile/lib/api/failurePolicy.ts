/** Pure failure classification for auth refresh and durable GET cache. */

export type ApiFailureLike = {
  status?: unknown;
  code?: unknown;
};

/**
 * Only an authoritative auth rejection proves that the refresh session is dead.
 * Transport errors, rate limits and 5xx responses must preserve credentials so
 * a temporary outage cannot log the user out.
 */
export function isAuthoritativeRefreshRejection(status: number): boolean {
  return status === 401 || status === 403;
}

/**
 * A stale durable GET is safer than an empty/error screen only for transient
 * failures. Client/auth errors (4xx except 429) stay authoritative and must not
 * be hidden by old data.
 */
export function shouldFallbackToDurableCache(error: unknown): boolean {
  if (error == null || typeof error !== 'object') return true;

  const failure = error as ApiFailureLike;
  const status = typeof failure.status === 'number' ? failure.status : undefined;
  const code = typeof failure.code === 'string' ? failure.code : undefined;

  if (status === 0 || code === 'network' || code === 'timeout') return true;
  if (status === 429 || code === 'rate_limit') return true;
  if (typeof status === 'number') return status >= 500;

  // Unknown runtime errors keep the previous best-effort cache behaviour.
  return true;
}
