/** Pure decision rules for offline replay (A-01) — без AsyncStorage / fetch. */

export type FlushDecision =
  | { action: 'drop' }
  | { action: 'conflict'; message: string }
  | { action: 'block'; message: string; attempts: number }
  | {
      action: 'retry';
      message: string;
      attempts: number;
      blocked: boolean;
      nextAttemptAt?: number;
    };

const MAX_ATTEMPTS = 5;
const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 5 * 60_000;

export function isPermanentClientError(status: number): boolean {
  return status >= 400 && status < 500 && ![408, 409, 425, 429].includes(status);
}

export function retryDelayMs(attempts: number, retryAfterMs?: number): number {
  const exponential = Math.min(
    RETRY_MAX_MS,
    RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1),
  );
  if (retryAfterMs == null || !Number.isFinite(retryAfterMs) || retryAfterMs <= 0) {
    return exponential;
  }
  return Math.min(RETRY_MAX_MS, Math.max(exponential, retryAfterMs));
}

export function parseRetryAfterMs(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return undefined;
  return Math.max(0, at - now);
}

export function decideFlushOutcome(
  status: number | null,
  message: string,
  currentAttempts: number,
  now = Date.now(),
  retryAfterMs?: number,
): FlushDecision {
  if (status !== null && status >= 200 && status < 300) return { action: 'drop' };
  if (status === 409) return { action: 'conflict', message };

  const attempts = currentAttempts + 1;
  if (status !== null && isPermanentClientError(status)) {
    return { action: 'block', message, attempts };
  }

  const blocked = attempts >= MAX_ATTEMPTS;
  return {
    action: 'retry',
    message,
    attempts,
    blocked,
    nextAttemptAt: blocked ? undefined : now + retryDelayMs(attempts, retryAfterMs),
  };
}

export { MAX_ATTEMPTS as FLUSH_MAX_ATTEMPTS };
export { RETRY_BASE_MS as FLUSH_RETRY_BASE_MS, RETRY_MAX_MS as FLUSH_RETRY_MAX_MS };
