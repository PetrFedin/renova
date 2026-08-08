/**
 * Temporary native share files on Expo FileSystem's modern SDK 56 API.
 * Web callers should keep using Blob/object URLs and never touch this helper.
 */
import { File, Paths } from 'expo-file-system';

export type TemporaryShareFile = {
  uri: string;
  filename: string;
};

export function sanitizeTemporaryFilename(filename: string, fallback: string): string {
  const safe = filename.trim().replace(/[^\w.-]+/g, '_').replace(/^\.+$/, '');
  return safe || fallback;
}

export function writeTemporaryShareFile(
  filename: string,
  content: string | Uint8Array,
  fallback: string,
): TemporaryShareFile {
  const safe = sanitizeTemporaryFilename(filename, fallback);
  const file = new File(Paths.cache, safe);
  file.write(content);
  return { uri: file.uri, filename: safe };
}
