/** P0: status=accepted графика — исполнитель не может; заказчик только после WA (бэкенд SoT) */
import type { WorkScheduleItemStatus } from '@/lib/api/workSchedule';
import type { OsRole } from '@/constants/osSections';

export function assertCanSetScheduleItemStatus(
  role: OsRole,
  status: WorkScheduleItemStatus,
): { ok: true } | { ok: false; message: string } {
  if (status !== 'accepted') return { ok: true };
  if (role !== 'customer') {
    return {
      ok: false,
      message:
        'Принять этап из графика может только заказчик — и только после приёмки с фото и чеклистом.',
    };
  }
  // customer: разрешаем вызов API; сервер вернёт 409 без customer_accepted_at
  return { ok: true };
}
