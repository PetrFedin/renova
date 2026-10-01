/** Вложения чата (COM-004): те же типы и лимит, что принимает backend (`storage_service._IMAGE_TYPES`). */

export const CHAT_ATTACHMENT_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
/** Совпадает с `storage_service.MAX_IMAGE_BYTES` (10 МБ). */
export const CHAT_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

export type ChatAttachmentCheck =
  | { ok: true; mimeType: string; bytes: number }
  | { ok: false; reason: 'unsupported_type' | 'too_large' | 'empty'; message: string };

/** Байтов в base64-строке без декодирования. */
export function base64DecodedBytes(base64: string): number {
  const clean = base64.replace(/\s+/g, '');
  if (!clean) return 0;
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.floor((clean.length * 3) / 4) - padding;
}

function normalizeMime(mime: string | null | undefined): string {
  const lower = (mime || '').trim().toLowerCase();
  return lower === 'image/jpg' ? 'image/jpeg' : lower;
}

export function validateChatAttachment(input: {
  mimeType?: string | null;
  base64?: string | null;
  fileSize?: number | null;
}): ChatAttachmentCheck {
  const mimeType = normalizeMime(input.mimeType);
  if (!(CHAT_ATTACHMENT_MIME_TYPES as readonly string[]).includes(mimeType)) {
    return {
      ok: false,
      reason: 'unsupported_type',
      message: 'В чат можно отправить только изображения JPEG, PNG или WebP. PDF и видео пока не поддерживаются.',
    };
  }
  const bytes = input.base64 ? base64DecodedBytes(input.base64) : input.fileSize ?? 0;
  if (!bytes) return { ok: false, reason: 'empty', message: 'Файл пустой или не прочитался.' };
  if (bytes > CHAT_ATTACHMENT_MAX_BYTES || (input.fileSize ?? 0) > CHAT_ATTACHMENT_MAX_BYTES) {
    const mb = Math.round(CHAT_ATTACHMENT_MAX_BYTES / (1024 * 1024));
    return { ok: false, reason: 'too_large', message: `Файл слишком большой: максимум ${mb} МБ.` };
  }
  return { ok: true, mimeType, bytes };
}

export function chatAttachmentDataUrl(mimeType: string, base64: string): string {
  return `data:${mimeType};base64,${base64}`;
}

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  gif: 'image/gif',
  pdf: 'application/pdf',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
};

/** MIME выбранного файла: из picker, иначе из data-URL или расширения (на web `mimeType` бывает пустым). */
export function guessAttachmentMime(asset: { mimeType?: string | null; uri?: string | null; fileName?: string | null }): string {
  if (asset.mimeType) return asset.mimeType;
  const data = /^data:([^;,]+)/i.exec(asset.uri || '');
  if (data) return data[1];
  const name = (asset.fileName || asset.uri || '').split('?')[0];
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  return EXT_MIME[ext] ?? '';
}
