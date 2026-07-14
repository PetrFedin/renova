/**
 * Wave 3e — единый выбор файла для Document Center upload.
 * Web: <input type=file>, Native: expo-document-picker (+ ImagePicker fallback для фото).
 */
import { Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';

export type PickedUploadFile = {
  uri: string;
  name: string;
  type: string;
};

const DOC_TYPES = [
  'application/pdf',
  'text/plain',
  'image/*',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const;

function guessMime(name: string, mime?: string | null): string {
  if (mime && mime !== 'application/octet-stream') return mime;
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.txt')) return 'text/plain';
  if (lower.endsWith('.docx')) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  return 'application/octet-stream';
}

async function pickWebFile(): Promise<PickedUploadFile | null> {
  if (typeof document === 'undefined') return null;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/pdf,image/*,text/plain,.doc,.docx,.xlsx';
  const file = await new Promise<File | null>((resolve) => {
    input.onchange = () => resolve(input.files?.[0] || null);
    input.click();
  });
  if (!file) return null;
  return {
    uri: URL.createObjectURL(file),
    name: file.name,
    type: guessMime(file.name, file.type),
  };
}

async function pickNativeDocument(): Promise<PickedUploadFile | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: [...DOC_TYPES],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];
  const name = asset.name || `document-${Date.now()}`;
  return {
    uri: asset.uri,
    name,
    type: guessMime(name, asset.mimeType),
  };
}

/** Fallback: галерея, если нужен только фото/скан. */
export async function pickImageForDocumentUpload(): Promise<PickedUploadFile | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;
  const pick = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.9,
  });
  if (pick.canceled || !pick.assets?.[0]) return null;
  const asset = pick.assets[0];
  const name = asset.fileName || `photo-${Date.now()}.jpg`;
  return {
    uri: asset.uri,
    name,
    type: guessMime(name, asset.mimeType),
  };
}

/**
 * Выбор файла под платформу.
 * @returns null если пользователь отменил
 */
export async function pickDocumentForUpload(): Promise<PickedUploadFile | null> {
  if (Platform.OS === 'web') {
    return pickWebFile();
  }
  try {
    return await pickNativeDocument();
  } catch {
    // Некоторые Expo Go / симуляторы без полного native module — fallback на фото
    return pickImageForDocumentUpload();
  }
}
