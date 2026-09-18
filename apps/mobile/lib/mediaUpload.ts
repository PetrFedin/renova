/** Загрузка файлов через presigned URL (S3 / local storage) */
import { Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { api } from '@/lib/api';
import { authHeaders } from '@/lib/api/client';

/**
 * Upload a blob and return the storage key the API should record.
 *
 * The key handed back by `getMediaUploadUrl` is an allocation, not a receipt.
 * This used to return it whenever `upload_url` was absent — which is exactly
 * what happens without object storage — so the photo was never sent, the
 * reference was saved against a file that did not exist, and every later read
 * answered 404. The user saw "фото прикреплено".
 *
 * There are now two ways to finish, and no way to finish without one of them.
 */
export async function uploadMediaBlob(userId: string, blob: Blob, contentType: string): Promise<string> {
  const up = await api.getMediaUploadUrl(userId);

  if (up.upload_url) {
    const res = await fetch(up.upload_url, { method: 'PUT', body: blob, headers: { 'Content-Type': contentType } });
    if (!res.ok) throw new Error(`upload failed: ${res.status}`);
    return up.key;
  }

  if (up.direct_upload_url) {
    const form = new FormData();
    // `as unknown as Blob` — React Native's FormData takes {uri,name,type} on
    // native and a real Blob on web; both satisfy the runtime, not the types.
    form.append('file', blob as unknown as Blob, 'photo.jpg');
    const res = await fetch(up.direct_upload_url, {
      method: 'POST',
      body: form,
      headers: authHeaders(userId),
    });
    if (!res.ok) throw new Error(`upload failed: ${res.status}`);
    const saved = (await res.json()) as { key?: string };
    if (!saved.key) throw new Error('upload failed: no key returned');
    return saved.key;
  }

  // Neither route offered. Failing here is the whole point: returning the key
  // would record a photo that does not exist.
  throw new Error('upload failed: no upload route available');
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
