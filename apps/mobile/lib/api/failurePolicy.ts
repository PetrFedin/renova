/** Pure failure classification for auth, durable GET cache and replay-safe writes. */

export type ApiFailureLike = {
  status?: unknown;
  code?: unknown;
  name?: unknown;
  message?: unknown;
};

export function getFailureStatus(error: unknown): number | undefined {
  if (error == null || typeof error !== 'object') return undefined;
  const status = (error as ApiFailureLike).status;
  return typeof status === 'number' ? status : undefined;
}

function getFailureCode(error: unknown): string | undefined {
  if (error == null || typeof error !== 'object') return undefined;
  const code = (error as ApiFailureLike).code;
  return typeof code === 'string' ? code : undefined;
}

function getFailureName(error: unknown): string | undefined {
  if (error == null || typeof error !== 'object') return undefined;
  const name = (error as ApiFailureLike).name;
  return typeof name === 'string' ? name : undefined;
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
 * Auto-queue is allowed only for mutations whose server contract is already
 * replay-safe through a stable client request id / equivalent idempotency key.
 * This classifier says whether the transport outcome is ambiguous; it does NOT
 * make an unsafe endpoint safe to retry.
 *
 * Deterministic 4xx, explicit aborts and session-generation changes are final
 * local outcomes and must never be converted into queued work.
 */
export function shouldQueueReplaySafeMutation(error: unknown): boolean {
  if (error == null) return false;

  const name = getFailureName(error);
  const code = getFailureCode(error);
  const status = getFailureStatus(error);

  if (name === 'AbortError') return false;
  if (code === 'session_generation_changed') return false;

  // status=0 is the HTTP client's canonical network/timeout sentinel.
  if (status === 0) return true;
  if (status === 429) return true;
  if (typeof status === 'number') return status >= 500;

  if (code === 'network' || code === 'timeout' || code === 'rate_limit') return true;

  // HTTP 2xx followed by malformed JSON leaves commit outcome ambiguous.
  if (error instanceof SyntaxError || name === 'SyntaxError') return true;

  // Raw fetch TypeError can still reach small helpers that do not use req().
  if (error instanceof TypeError || name === 'TypeError') return true;

  // Unknown programming/runtime failures fail closed; do not create hidden work.
  return false;
}

/**
 * A stale durable GET is safer than an empty/error screen only for transient
 * failures. Client/auth errors (4xx except 429) stay authoritative and must not
 * be hidden by old data.
 */
export function shouldFallbackToDurableCache(error: unknown): boolean {
  if (error == null || typeof error !== 'object') return true;

  const status = getFailureStatus(error);
  const code = getFailureCode(error);

  // Numeric HTTP status is authoritative when present. status=0 is the local
  // transport sentinel used by the client for network/timeout failures.
  if (status === 0) return true;
  if (status === 429) return true;
  if (typeof status === 'number') return status >= 500;

  if (code === 'network' || code === 'timeout' || code === 'rate_limit') return true;
  if (code === 'session_generation_changed') return false;

  // Unknown runtime errors keep the previous best-effort cache behaviour.
  return true;
}
