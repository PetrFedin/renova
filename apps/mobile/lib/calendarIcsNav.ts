/** W124: честность ICS + CTA на график SoT (Fieldwire/Houzz-style: export → calendar app) */
import { Alert } from 'react-native';
import { pushOsNav } from '@/lib/pushOsNav';
import { calendarTabRoute, type OsRole } from '@/constants/osSections';

/** Разовый файл, не двусторонняя синхронизация с Google/Apple */
export const ICS_SYNC_HONESTY =
  'Это разовый .ics-файл для импорта в Google/Apple Calendar — не live-синхронизация. После изменений в Renova экспортируйте снова.';

export function alertIcalExported(role: OsRole) {
  Alert.alert('Календарь ICS', ICS_SYNC_HONESTY, [
    { text: 'OK' },
    {
      text: 'Открыть график',
      onPress: () => pushOsNav(calendarTabRoute(role)),
    },
  ]);
}

export function alertIcalImported(updatedStages: number | string | undefined, role: OsRole, onOk?: () => void) {
  Alert.alert('Календарь', `Обновлено этапов: ${updatedStages ?? '—'}`, [
    {
      text: 'OK',
      onPress: () => onOk?.(),
    },
    {
      text: 'Открыть график',
      onPress: () => {
        onOk?.();
        pushOsNav(calendarTabRoute(role));
      },
    },
  ]);
}
