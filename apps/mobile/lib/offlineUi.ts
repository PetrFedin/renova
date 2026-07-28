/** Человеческие сообщения для офлайн-очереди — без технического offline_queued (W66 #24).
 * Clarity E: sheet вместо Alert. */
import { OFFLINE_MESSAGES } from '@/lib/offlineErrors';
import { pushOsNav } from '@/lib/pushOsNav';
import { showActionConfirm } from '@/lib/actionConfirmBus';
import type { OsRole } from '@/constants/osSections';

export function isOfflineQueued(e: unknown): boolean {
  return e instanceof Error && e.message === 'offline_queued';
}

export function isOfflineBlocked(e: unknown): string | null {
  if (e instanceof Error && e.message in OFFLINE_MESSAGES) return e.message;
  return null;
}

/** Короткое уведомление + CTA в очередь конфликтов (не тупик OK) */
export function notifyOfflineQueued(actionLabel = 'Действие', role: OsRole = 'customer'): void {
  showActionConfirm({
    title: 'Нет сети',
    message: `${actionLabel} поставлено в очередь и выполнится при появлении интернета. Не закрывайте приложение сразу.`,
    primaryLabel: 'Очередь',
    onPrimary: () => pushOsNav('/conflicts', undefined, role),
    secondaryLabel: 'Понятно',
    onSecondary: () => undefined,
  });
}

export function notifyOfflineBlocked(
  e: unknown,
  fallback = 'Действие недоступно без интернета.',
  role: OsRole = 'customer',
): void {
  const code = isOfflineBlocked(e);
  showActionConfirm({
    title: 'Нет сети',
    message: code ? OFFLINE_MESSAGES[code] : fallback,
    primaryLabel: 'Конфликты',
    onPrimary: () => pushOsNav('/conflicts', undefined, role),
    secondaryLabel: 'Понятно',
    onSecondary: () => undefined,
  });
}
