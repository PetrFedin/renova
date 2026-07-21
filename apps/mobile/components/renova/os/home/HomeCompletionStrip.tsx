/** Ссылки после завершения — без отдельного заголовка, живут в «Ещё» */
import { useState } from 'react';
import { Alert } from 'react-native';
import { api } from '@/lib/api';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
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
  const { user, activeProject } = useRenova();
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
      {/* W55: closeout/warranty в Document Center — главный финал, не только KPI PDF */}
      <HomeLinkRow title="Закрытие и документы" onPress={() => pushScreen('/documents')} />
      <HomeLinkRow title="Отчёты проекта" onPress={() => pushScreen('/reports')} />
      <HomeLinkRow
        title={busy ? 'Дайджест…' : 'Недельный дайджест'}
        onPress={() => {
          if (busy) return;
          setBusy(true);
          api.pushWeeklyDigest(userId, projectId)
            .then(async (res) => {
              // W97: уведомления/inbox после дайджеста
              await syncProjectSideEffects({
                user: user ?? ({ id: userId } as any),
                project: activeProject ?? ({ id: projectId } as any),
                role,
              });
              Alert.alert(
                'Дайджест',
                `Отправлено: ${res.notified}. ${(res.body || '').slice(0, 160)}`,
                [
                  { text: 'OK' },
                  { text: 'Документы', onPress: () => pushScreen('/documents') },
                ],
              );
            })
            .catch(() => Alert.alert('Дайджест', 'Не удалось отправить'))
            .finally(() => setBusy(false));
        }}
      />
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
