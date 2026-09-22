/** W124: честность ICS + CTA на график SoT (Fieldwire/Houzz-style: export → calendar app).
 * Clarity H: sheet вместо Alert. */
import { pushOsNav } from '@/lib/pushOsNav';
import { calendarTabRoute, type OsRole } from '@/constants/osSections';
import { showActionConfirm } from '@/lib/actionConfirmBus';

/**
 * Разовый файл против живой ленты: после появления подписки прежняя формулировка
 * «не live-синхронизация» стала неправдой про календарь вообще, хотя про сам
 * экспорт остаётся верной. Поэтому говорим про оба пути сразу.
 */
export const ICS_SYNC_HONESTY =
  'Экспорт — разовый .ics-файл: после изменений в Renova выгрузите снова. Нужны обновления сами — заведите подписку на календарь, она отдаёт живую ленту в одну сторону: правки в Google или Apple Calendar в Renova не вернутся.';

export function alertIcalExported(role: OsRole) {
  showActionConfirm({
    title: 'Календарь ICS',
    message: ICS_SYNC_HONESTY,
    primaryLabel: 'Открыть график',
    onPrimary: () => pushOsNav(calendarTabRoute(role)),
    secondaryLabel: 'Понятно',
    onSecondary: () => undefined,
  });
}

export function alertIcalImported(updatedStages: number | string | undefined, role: OsRole, onOk?: () => void) {
  showActionConfirm({
    title: 'Календарь',
    message: `Обновлено этапов: ${updatedStages ?? '—'}`,
    primaryLabel: 'Открыть график',
    onPrimary: () => {
      onOk?.();
      pushOsNav(calendarTabRoute(role));
    },
    secondaryLabel: 'Понятно',
    onSecondary: () => {
      onOk?.();
    },
  });
}
