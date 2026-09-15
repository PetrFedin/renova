/** Загрузка файлов через project-scoped presigned URL (S3 / local storage) */
import { Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { req } from '@/lib/api/client';

export type ProjectMediaUploadIntent = {
  key: string;
  upload_url?: string | null;
  public_url: string;
  content_type?: string;
};

export class ProjectMediaUploadUnavailable extends Error {
  code = 'project_media_upload_transport_unavailable' as const;

  constructor() {
    super('Project media upload transport is unavailable');
    this.name = 'ProjectMediaUploadUnavailable';
  }
}

/**
 * Запросить storage key, уже привязанный к объекту и write ACL.
 * Project id фиксируется до загрузки bytes; чужой key нельзя потом прикрепить
 * к другой project mutation.
 */
export async function getProjectMediaUploadIntent(
  userId: string,
  projectId: string,
  contentType: string,
  filename?: string,
): Promise<ProjectMediaUploadIntent> {
  return req<ProjectMediaUploadIntent>(
    '/api/v1/media/upload-url',
    {
      method: 'POST',
      body: JSON.stringify({
        project_id: projectId,
        content_type: contentType || 'application/octet-stream',
        filename: filename || null,
      }),
    },
    userId,
  );
}

/** PUT blob на project-scoped presigned URL, возвращает canonical storage key. */
export async function uploadMediaBlob(
  userId: string,
  projectId: string,
  blob: Blob,
  contentType: string,
  filename?: string,
): Promise<string> {
  const normalizedType = contentType || blob.type || 'application/octet-stream';
  const up = await getProjectMediaUploadIntent(userId, projectId, normalizedType, filename);
  if (!up.upload_url) {
    // Do not attach metadata to bytes that were never persisted. Callers with an
    // explicit inline fallback (stage photos) may handle this typed condition.
    throw new ProjectMediaUploadUnavailable();
  }
  const res = await fetch(up.upload_url, {
    method: 'PUT',
    body: blob,
    headers: { 'Content-Type': normalizedType },
  });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
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
