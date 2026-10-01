/**
 * Единый текст результата записи для экранов (CMP-006, CMP-011).
 *
 * Обёртки API бросают `Error('offline_queued')`, когда действие поставлено в
 * офлайн-очередь. Это не ошибка: экран не должен показывать технический код
 * и тем более «Не удалось …».
 */
import { failureReason } from '@/lib/notifyMessage';

export const OFFLINE_SAVED_MESSAGE = 'Сохранено, отправится при появлении сети';

export function isQueuedResult(error: unknown): boolean {
  return error instanceof Error && error.message === 'offline_queued';
}

/** Человеческий текст для результата-исключения записи. */
export function writeResultMessage(error: unknown, fallback: string): string {
  if (isQueuedResult(error)) return OFFLINE_SAVED_MESSAGE;
  return failureReason(error) ?? fallback;
}
