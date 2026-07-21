/** W124: экспорт .ics — web download + native Share (как CSV/PDF). Разовый файл, не live-синк. */
import { Platform, Alert } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export async function exportIcalFile(userId: string, projectId: string, filename = 'renova.ics') {
  const base = process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:8100';
  const r = await fetch(`${base}/api/v1/projects/${projectId}/calendar.ics`, {
    headers: { 'X-User-Id': userId },
  });
  if (!r.ok) throw new Error('ical');

  const safe = filename.replace(/[^\w.-]+/g, '_') || 'renova.ics';

  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const blob = await r.blob();
    const u = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = u;
    a.download = safe;
    a.click();
    URL.revokeObjectURL(u);
    return;
  }

  const text = await r.text();
  const cache = FileSystem.cacheDirectory;
  if (!cache) {
    Alert.alert('Календарь', 'Нет доступа к файловой системе');
    return;
  }
  const out = `${cache}${safe}`;
  await FileSystem.writeAsStringAsync(out, text, { encoding: FileSystem.EncodingType.UTF8 });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(out, {
      mimeType: 'text/calendar',
      UTI: 'public.calendar-event',
      dialogTitle: 'Импорт в календарь устройства',
    });
  } else {
    Alert.alert('Календарь', 'Файл сохранён во временную папку приложения.');
  }
}
