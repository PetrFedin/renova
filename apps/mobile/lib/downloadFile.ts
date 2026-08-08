/** Скачивание файлов с API — web download + native share sheet (P2.4) */
import { Alert, Platform } from 'react-native';
import * as Sharing from 'expo-sharing';
import { fetchPdfBlob, openPdfBlob } from '@/lib/pdfOpen';
import { authHeaders } from '@/lib/api/client';
import { writeTemporaryShareFile } from '@/lib/tempShareFile';

export async function downloadFromApi(userId: string, url: string, filename: string) {
  const isPdf = filename.toLowerCase().endsWith('.pdf') || url.toLowerCase().includes('.pdf');
  if (isPdf) {
    const path = url.startsWith('http') ? new URL(url).pathname : url;
    await downloadProjectPdf(userId, path, filename);
    return;
  }

  const r = await fetch(url, { headers: authHeaders(userId) });
  if (!r.ok) throw new Error('download failed');
  const blob = await r.blob();

  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const u = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = u;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(u);
    return;
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  const temporary = writeTemporaryShareFile(filename, bytes, 'file.bin');
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(temporary.uri);
  } else {
    Alert.alert('Файл', `Сохранено: ${temporary.filename}`);
  }
}

export async function downloadProjectPdf(userId: string, path: string, filename: string) {
  const blob = await fetchPdfBlob(userId, path);
  await openPdfBlob(blob, filename, Platform.OS === 'web' ? 'download' : 'share');
}

/** Скачать файл по API path — PDF через share sheet на native, остальное через downloadFromApi */
export async function downloadApiPath(userId: string, path: string, filename: string) {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  if (filename.toLowerCase().endsWith('.pdf') || normalized.toLowerCase().includes('.pdf')) {
    await downloadProjectPdf(userId, normalized, filename);
    return;
  }
  await downloadFromApi(userId, apiFileUrl(normalized), filename);
}

export function apiFileUrl(path: string) {
  const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:8100';
  return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}
