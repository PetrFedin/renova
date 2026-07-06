import * as ImageManipulator from 'expo-image-manipulator';

export function compressDataUrl(dataUrl: string, maxLen = 400_000): string {
  if (dataUrl.length <= maxLen) return dataUrl;
  return dataUrl.slice(0, maxLen);
}

export async function compressUri(uri: string, width = 1200): Promise<string> {
  const r = await ImageManipulator.manipulateAsync(uri, [{ resize: { width } }], { compress: 0.6, format: ImageManipulator.SaveFormat.JPEG });
  return r.uri;
}

export async function compressBlob(blob: Blob, maxBytes = 400_000): Promise<Blob> {
  if (blob.size <= maxBytes) return blob;
  if (typeof document === 'undefined') return blob.slice(0, maxBytes);
  const img = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, Math.sqrt(maxBytes / blob.size));
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((res) => canvas.toBlob((b) => res(b || blob), 'image/jpeg', 0.6)!);
}
