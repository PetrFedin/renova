/** Открытие PDF — preview / share на native, download на web */
import { Platform, Alert } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { authHeaders } from '@/lib/api/client';

export async function fetchPdfBlob(userId: string, path: string): Promise<Blob> {
  const base = process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:8100';
  const r = await fetch(`${base}${path}`, { headers: authHeaders(userId) });
  if (!r.ok) throw new Error('PDF error');
  return r.blob();
}

async function blobToBase64(blob: Blob): Promise<string> {
  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        resolve(dataUrl.split(',')[1] || '');
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  if (typeof globalThis.btoa === 'function') return globalThis.btoa(binary);
  throw new Error('base64 unavailable');
}

/** Native: in-app browser с embedded PDF */
async function openPdfNativePreview(blob: Blob, filename: string) {
  const b64 = await blobToBase64(blob);
  const html = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${filename}</title><style>html,body{margin:0;height:100%;}embed{width:100%;height:100%;}</style></head><body><embed src="data:application/pdf;base64,${b64}" type="application/pdf"/></body></html>`;
  const uri = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  try {
    await WebBrowser.openBrowserAsync(uri, {
      presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN,
      enableBarCollapsing: true,
    });
  } catch {
    Alert.alert('Просмотр PDF', 'Не удалось открыть документ.');
  }
}

/** Native: сохранить во временный файл и открыть share sheet */
async function sharePdfNative(blob: Blob, filename: string) {
  const safe = filename.replace(/[^\w.-]+/g, '_') || 'document.pdf';
  const path = `${FileSystem.cacheDirectory}${safe}`;
  const b64 = await blobToBase64(blob);
  await FileSystem.writeAsStringAsync(path, b64, { encoding: FileSystem.EncodingType.Base64 });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(path, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
  } else {
    await openPdfNativePreview(blob, safe);
  }
}

export async function openPdfBlob(blob: Blob, filename: string, mode: 'preview' | 'download' | 'share' = 'download') {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const u = URL.createObjectURL(blob);
    if (mode === 'preview') {
      window.open(u, '_blank', 'noopener,noreferrer');
    } else {
      const a = document.createElement('a');
      a.href = u;
      a.download = filename;
      a.click();
    }
    setTimeout(() => URL.revokeObjectURL(u), 60_000);
    return;
  }

  if (mode === 'preview') {
    await openPdfNativePreview(blob, filename);
    return;
  }

  await sharePdfNative(blob, filename);
}

export async function previewProjectPdf(userId: string, path: string, filename: string) {
  const blob = await fetchPdfBlob(userId, path);
  await openPdfBlob(blob, filename, 'preview');
}

export async function downloadProjectPdf(userId: string, path: string, filename: string) {
  const blob = await fetchPdfBlob(userId, path);
  await openPdfBlob(blob, filename, 'download');
}
