/** Загрузка файлов через presigned URL (S3 / local storage) */
import { Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { api } from '@/lib/api';

/** PUT blob на presigned URL, возвращает storage key для API */
export async function uploadMediaBlob(userId: string, blob: Blob, contentType: string): Promise<string> {
  const up = await api.getMediaUploadUrl(userId);
  if (up.upload_url) {
    const res = await fetch(up.upload_url, { method: 'PUT', body: blob, headers: { 'Content-Type': contentType } });
    if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  }
  return up.key;
}

/** Выбор файла в web через скрытый input */
export function pickFileWeb(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve(null);
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

/** Чтение .ics / текстового файла в web */
export async function readTextFileWeb(accept = '.ics,text/calendar'): Promise<string | null> {
  const file = await pickFileWeb(accept);
  if (!file) return null;
  return file.text();
}

/** P2.4: импорт .ics — web picker или native document picker */
export async function readIcalFile(): Promise<string | null> {
  if (Platform.OS === 'web') {
    return readTextFileWeb('.ics,text/calendar');
  }
  const picked = await DocumentPicker.getDocumentAsync({
    type: ['text/calendar', 'application/ics', '*/*'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (picked.canceled || !picked.assets?.[0]?.uri) return null;
  return FileSystem.readAsStringAsync(picked.assets[0].uri);
}
