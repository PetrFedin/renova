/** W124: экспорт .ics — web download + native Share (как CSV/PDF). Разовый файл, не live-синк. */
import { Platform, Alert } from 'react-native';
import * as Sharing from 'expo-sharing';
import { authHeaders } from '@/lib/api/client';
import { writeTemporaryShareFile } from '@/lib/tempShareFile';

export async function exportIcalFile(userId: string, projectId: string, filename = 'renova.ics') {
  const base = process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:8100';
  const r = await fetch(`${base}/api/v1/projects/${projectId}/calendar.ics`, {
    headers: authHeaders(userId),
  });
  if (!r.ok) throw new Error('ical');

  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const blob = await r.blob();
    const u = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = u;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(u);
    return;
  }

  const text = await r.text();
  const temporary = writeTemporaryShareFile(filename, text, 'renova.ics');
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(temporary.uri, {
      mimeType: 'text/calendar',
      UTI: 'public.calendar-event',
      dialogTitle: 'Импорт в календарь устройства',
    });
  } else {
    Alert.alert('Календарь', 'Файл сохранён во временную папку приложения.');
  }
}
