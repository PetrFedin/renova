/** Выгрузка CSV проекта — web download + native share */
import { Platform, Alert } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { authHeaders } from '@/lib/api/client';

export async function exportProjectCsvFile(
  userId: string,
  path: string,
  filename: string,
) {
  const base = process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:8100';
  const r = await fetch(`${base}${path}`, {
    headers: authHeaders(userId),
  });
  if (!r.ok) throw new Error('csv');

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
  const safe = filename.replace(/[^\w.-]+/g, '_') || 'renova.csv';
  const cache = FileSystem.cacheDirectory;
  if (!cache) {
    Alert.alert('Экспорт', 'Нет доступа к файловой системе');
    return;
  }
  const out = `${cache}${safe}`;
  await FileSystem.writeAsStringAsync(out, text, { encoding: FileSystem.EncodingType.UTF8 });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(out, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text' });
  } else {
    Alert.alert('Экспорт', 'Файл сохранён во временную папку приложения.');
  }
}
