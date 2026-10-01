/** Выгрузка CSV расходов — web download + native share */
import { Platform } from 'react-native';
import { notifyAlert } from '@/lib/notify';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { API_BASE, authHeaders } from '@/lib/api/client';

export async function exportExpensesCsvFile(userId: string, projectId: string, filename = 'renova-expenses.csv') {
  // HOM-21: адрес и проверка стенда — из общего клиента, а не из своей копии переменной.
  const r = await fetch(`${API_BASE}/api/v1/projects/${projectId}/analytics/expenses.csv`, {
    headers: authHeaders(userId),
  });
  if (!r.ok) {
    throw new Error(
      r.status === 401 || r.status === 403
        ? 'Нет доступа к выгрузке расходов этого объекта.'
        : r.status === 404
          ? 'Объект не найден.'
          : 'Сервер не смог подготовить таблицу. Попробуйте позже.',
    );
  }

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
    notifyAlert('Экспорт', 'Файл сохранён во временную папку приложения.');
  }
}
