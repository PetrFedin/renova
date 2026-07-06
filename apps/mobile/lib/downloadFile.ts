/** Скачивание файлов с API — web download + fallback alert на native */
import { Alert, Platform } from 'react-native';

export async function downloadFromApi(userId: string, url: string, filename: string) {
  const r = await fetch(url, { headers: { 'X-User-Id': userId } });
  if (!r.ok) throw new Error('download failed');
  const blob = await r.blob();
  if (typeof window !== 'undefined') {
    const u = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = u;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(u);
    return;
  }
  Alert.alert('Документ', Platform.OS === 'ios' ? 'Скачивание доступно в web-версии preview.' : 'Откройте приложение в браузере для PDF.');
}

export function apiFileUrl(path: string) {
  const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:8100';
  return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}
