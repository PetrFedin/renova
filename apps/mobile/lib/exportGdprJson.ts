/** GDPR JSON export — web download + native share (как CSV/PDF) */
import { Platform, Alert } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export async function exportGdprJsonFile(data: unknown, filename = 'renova-export.json') {
  const text = JSON.stringify(data, null, 2);

  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const blob = new Blob([text], { type: 'application/json' });
    const u = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = u;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(u);
    return;
  }

  const safe = filename.replace(/[^\w.-]+/g, '_') || 'renova-export.json';
  const path = `${FileSystem.cacheDirectory}${safe}`;
  await FileSystem.writeAsStringAsync(path, text, { encoding: FileSystem.EncodingType.UTF8 });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(path, { mimeType: 'application/json', UTI: 'public.json' });
  } else {
    Alert.alert('Экспорт', 'Файл сохранён во временную папку приложения.');
  }
}
