/**
 * Что показать, когда действие не удалось.
 *
 * В пяти местах обработка выглядела так:
 *
 *     catch (e) { if (isOfflineQueued(e)) notifyOfflineQueued('Согласование'); }
 *
 * То есть при ответе 500, 403 или обрыве связи не происходило ничего: ни
 * сообщения, ни записи в отчёт об ошибках, ни обновления списка. Окно
 * подтверждения закрывалось, и человек считал, что решение принято. Для
 * согласования доп. работ это означало, что деньги висят, а обе стороны
 * уверены в обратном.
 *
 * Офлайн — не ошибка: действие встало в очередь, об этом и говорим. Всё
 * остальное объясняем и записываем.
 */
import { isOfflineQueued, notifyOfflineQueued } from '@/lib/offlineUi';
import { showActionConfirm } from '@/lib/actionConfirmBus';
import { reportError } from '@/lib/reportError';

export type MutationFailure = 'queued' | 'failed';

export function explainMutationFailure(
  error: unknown,
  options: {
    /** Действие в именительном падеже: «Согласование», «Закрепление чата». */
    action: string;
    /** Метка для отчёта об ошибке: «approvals.approve». */
    scope: string;
    context?: Record<string, unknown>;
  },
): MutationFailure {
  if (isOfflineQueued(error)) {
    notifyOfflineQueued(options.action);
    return 'queued';
  }
  reportError(options.scope, error, options.context);
  showActionConfirm({
    title: `${options.action}: не удалось`,
    message: error instanceof Error && error.message
      ? error.message
      : 'Проверьте связь и повторите.',
    primaryLabel: 'Понятно',
    onPrimary: () => undefined,
  });
  return 'failed';
}
