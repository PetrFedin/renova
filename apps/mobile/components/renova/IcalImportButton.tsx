/** Импорт iCal из файла (web) */
import { useState } from 'react';
import { Platform, Alert } from 'react-native';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { api } from '@/lib/api';
import { readTextFileWeb } from '@/lib/mediaUpload';
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
  const [busy, setBusy] = useState(false);

  const runImport = async (content: string) => {
    if (!content.includes('BEGIN:VCALENDAR')) {
      Alert.alert('Календарь', 'Некорректный формат — нужен BEGIN:VCALENDAR');
      return;
    }
    setBusy(true);
    try {
      const r = await api.importIcal(userId, projectId, content);
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
        if (Platform.OS !== 'web') {
          Alert.alert('Календарь', 'Импорт .ics доступен в веб-версии Renova');
          return;
        }
        const text = await readTextFileWeb('.ics,text/calendar');
        if (text) await runImport(text);
      }}
    />
  );
}
