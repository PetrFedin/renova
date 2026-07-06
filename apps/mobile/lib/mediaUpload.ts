/** Загрузка файлов через presigned URL (S3 / local storage) */
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
