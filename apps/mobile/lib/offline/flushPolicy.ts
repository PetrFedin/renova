/** Pure decision rules for offline replay (A-01) — без AsyncStorage / fetch. */

export type FlushDecision =
  | { action: 'drop' }
  | { action: 'conflict'; message: string }
  | { action: 'block'; message: string }
  | { action: 'retry'; message: string; attempts: number; blocked: boolean };

const MAX_ATTEMPTS = 5;

export function isPermanentClientError(status: number): boolean {
  return status >= 400 && status < 500 && ![408, 409, 425, 429].includes(status);
}

export function decideFlushOutcome(
  status: number | null,
  message: string,
  currentAttempts: number,
): FlushDecision {
  if (status === null) {
    const attempts = currentAttempts + 1;
    return { action: 'retry', message, attempts, blocked: attempts >= MAX_ATTEMPTS };
  }
  if (status >= 200 && status < 300) return { action: 'drop' };
  if (status === 409) return { action: 'conflict', message };
  if (isPermanentClientError(status)) return { action: 'block', message };
  const attempts = currentAttempts + 1;
  return { action: 'retry', message, attempts, blocked: attempts >= MAX_ATTEMPTS };
}

export { MAX_ATTEMPTS as FLUSH_MAX_ATTEMPTS };
