/**
 * Стабильный ключ идемпотентности «на попытку пользователя» для вызовов,
 * у которых нет собственного владельца ключа (форма/ref), — CMP-005.
 *
 * Пока попытка не завершилась успехом или авторитетным отказом, повтор того же
 * запроса (тот же пользователь, тот же сериализованный body) получает тот же
 * ключ, и сервер отдаёт исходный результат вместо второго объекта. Изменённое
 * тело — это уже другая попытка и получает новый ключ.
 */
import { createClientRequestId } from '@/lib/clientRequestId';

const pending = new Map<string, string>();
const MAX_PENDING = 50;

function fingerprint(userId: string, scope: string, body: string): string {
  return `${userId}\u0000${scope}\u0000${body}`;
}

export function getAttemptKey(userId: string, scope: string, body: string): string {
  const fp = fingerprint(userId, scope, body);
  const existing = pending.get(fp);
  if (existing) return existing;
  if (pending.size >= MAX_PENDING) pending.delete(pending.keys().next().value as string);
  const key = createClientRequestId(scope);
  pending.set(fp, key);
  return key;
}

export function releaseAttemptKey(userId: string, scope: string, body: string): void {
  pending.delete(fingerprint(userId, scope, body));
}

/** Тест-хук. */
export function _resetAttemptKeys(): void {
  pending.clear();
}
