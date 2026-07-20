/** Импорт iCal из файла (web) */
import { useState } from 'react';
import { Alert } from 'react-native';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { api } from '@/lib/api';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { readIcalFile } from '@/lib/mediaUpload';
import { t } from '@/lib/i18n';

export function IcalImportButton({
  userId,
  projectId,
  onImported,
  disabled,
}: {
  userId: string;
  projectId: string;
  onImported?: () => void;
  disabled?: boolean;
}) {
  const { user, activeProject } = useRenova();
  const [busy, setBusy] = useState(false);

  const runImport = async (content: string) => {
    if (!content.includes('BEGIN:VCALENDAR')) {
      Alert.alert('Календарь', 'Некорректный формат — нужен BEGIN:VCALENDAR');
      return;
    }
    setBusy(true);
    try {
      const r = await api.importIcal(userId, projectId, content);
      // W99: график/home после ICS
      await syncProjectSideEffects({
        user: user ?? ({ id: userId } as any),
        project: activeProject ?? ({ id: projectId } as any),
      });
      Alert.alert('Календарь', `Обновлено этапов: ${(r as { updated_stages?: number }).updated_stages ?? '—'}`);
      onImported?.();
    } catch {
      Alert.alert('Календарь', 'Не удалось импортировать календарь');
    } finally {
      setBusy(false);
    }
  };

  return (
    <PrimaryButton
      disabled={disabled || busy}
      title={busy ? 'Импорт…' : t('importIcal')}
      variant="outline"
      onPress={async () => {
        const text = await readIcalFile();
        if (text) await runImport(text);
      }}
    />
  );
}
