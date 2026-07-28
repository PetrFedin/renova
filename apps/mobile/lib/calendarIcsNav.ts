/** W124: честность ICS + CTA на график SoT (Fieldwire/Houzz-style: export → calendar app).
 * Clarity H: sheet вместо Alert. */
import { pushOsNav } from '@/lib/pushOsNav';
import { calendarTabRoute, type OsRole } from '@/constants/osSections';
import { showActionConfirm } from '@/lib/actionConfirmBus';

/** Разовый файл, не двусторонняя синхронизация с Google/Apple */
export const ICS_SYNC_HONESTY =
  'Это разовый .ics-файл для импорта в Google/Apple Calendar — не live-синхронизация. После изменений в Renova экспортируйте снова.';

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
