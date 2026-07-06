/** Выгрузка CSV расходов — web download + native share */
import { Platform, Alert } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export async function exportExpensesCsvFile(userId: string, projectId: string, filename = 'renova-expenses.csv') {
  const base = process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:8100';
  const r = await fetch(`${base}/api/v1/projects/${projectId}/analytics/expenses.csv`, {
    headers: { 'X-User-Id': userId },
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
  const safe = filename.replace(/[^\w.-]+/g, '_') || 'renova-expenses.csv';
  const path = `${FileSystem.cacheDirectory}${safe}`;
  await FileSystem.writeAsStringAsync(path, text, { encoding: FileSystem.EncodingType.UTF8 });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(path, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text' });
  } else {
    Alert.alert('Экспорт', 'Файл сохранён во временную папку приложения.');
  }
}
