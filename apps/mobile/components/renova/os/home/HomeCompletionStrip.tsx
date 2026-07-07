/** Ссылки после завершения — без отдельного заголовка, живут в «Ещё» */
import { useState } from 'react';
import { Alert } from 'react-native';
import { HomeLinkRow } from '@/components/renova/os/HomeLinkRow';
import { exportExpensesCsvFile } from '@/lib/exportExpensesCsv';
import type { OsRole } from '@/constants/osSections';
import { useOsNavFromHere } from '@/lib/navigation';

type Props = {
  role: OsRole;
  userId: string;
  projectId: string;
};

export function HomeCompletionLinks({ role, userId, projectId }: Props) {
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
    <>
      <HomeLinkRow title="Отчёты проекта" onPress={() => pushScreen('/reports')} />
      <HomeLinkRow
        title={busy ? 'Выгрузка…' : 'Экспорт расходов (CSV)'}
        onPress={() => { if (!busy) exportCsv(); }}
      />
    </>
  );
}

/** @deprecated Используйте HomeCompletionLinks внутри HomeMoreSection */
export function HomeCompletionStrip(props: Props) {
  return <HomeCompletionLinks {...props} />;
}
