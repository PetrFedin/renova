/** Действия после завершения проекта — отчёты и экспорт */
import { useState } from 'react';
import { View, Text, Alert } from 'react-native';
import { homeRowStyles, homeTypography } from '@/constants/homeTypography';
import { HomeLinkRow } from '@/components/renova/os/HomeLinkRow';
import { exportExpensesCsvFile } from '@/lib/exportExpensesCsv';
import type { OsRole } from '@/constants/osSections';
import { useOsNavFromHere } from '@/lib/navigation';

type Props = {
  role: OsRole;
  userId: string;
  projectId: string;
};

export function HomeCompletionStrip({ role, userId, projectId }: Props) {
  const { pushScreen } = useOsNavFromHere(role);
  const [busy, setBusy] = useState(false);

  async function exportCsv() {
    setBusy(true);
    try {
      await exportExpensesCsvFile(userId, projectId);
    } catch {
      Alert.alert('Ошибка', 'Не удалось выгрузить таблицу. Проверьте сервер.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={homeRowStyles.zone}>
      <Text style={[homeTypography.zoneLabel, homeRowStyles.zoneTitleOnly]}>После завершения</Text>
      <HomeLinkRow title="Отчёты проекта" onPress={() => pushScreen('/reports')} />
      <HomeLinkRow
        title={busy ? 'Выгрузка…' : 'Экспорт расходов (CSV)'}
        onPress={() => { if (!busy) exportCsv(); }}
      />
    </View>
  );
}
