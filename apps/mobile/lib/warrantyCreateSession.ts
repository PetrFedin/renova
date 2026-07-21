/**
 * Идемпотентность create warranty на клиенте.
 * - Новый пользовательский submit → новый key.
 * - Retry после timeout/сети → тот же key (без авто-создания второго).
 * - После success → clear.
 */
let pendingKey: string | null = null;

function randomKey(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = (globalThis as any).crypto;
    if (c?.randomUUID) return c.randomUUID();
  } catch {
    /* ignore */
  }
  return `warr-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Старт нового submit (кнопка «Создать»). */
export function beginWarrantyCreate(): string {
  pendingKey = randomKey();
  return pendingKey;
}

/** Повтор после timeout / network — тот же key, если сессия открыта. */
export function warrantyCreateKeyForRetry(): string {
  if (!pendingKey) pendingKey = randomKey();
  return pendingKey;
}

export function peekWarrantyCreateKey(): string | null {
  return pendingKey;
}

export function clearWarrantyCreateSession(): void {
  pendingKey = null;
}

/** Для unit-тестов. */
export function __resetWarrantyCreateSessionForTests(): void {
  pendingKey = null;
}
