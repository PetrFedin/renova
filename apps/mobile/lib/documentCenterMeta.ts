/**
 * Wave 3d — подписи meta OCR / legal hold / source для Document Center UI.
 * Чистые функции: удобно тестировать без RN.
 */
import type { ProjectDocument } from '@/lib/api/types/documents';

export type OcrMeta = {
  status?: string | null;
  suggested_type?: string | null;
  confidence?: number | null;
};

export function readOcrMeta(doc: ProjectDocument): OcrMeta | null {
  const raw = doc.meta?.ocr;
  if (!raw || typeof raw !== 'object') return null;
  return raw as OcrMeta;
}

export function isLegalHold(doc: ProjectDocument): boolean {
  return Boolean(doc.meta?.legal_hold);
}

export function ocrStatusLabel(ocr: OcrMeta | null | undefined): string | null {
  if (!ocr?.status || ocr.status === 'none') return null;
  const conf =
    typeof ocr.confidence === 'number' ? ` ${(Math.round(ocr.confidence * 100))}%` : '';
  const suggested = ocr.suggested_type ? ` → ${ocr.suggested_type}` : '';
  switch (ocr.status) {
    case 'queued':
      return 'OCR в очереди';
    case 'processing':
      return 'OCR…';
    case 'done':
      // W67 #29: stub ≠ распознанный документ
      return `OCR демо-классификация${suggested}${conf}`;
    case 'failed':
      return 'OCR ошибка';
    default:
      return `OCR ${ocr.status}`;
  }
}

export function documentCenterSubtitle(doc: ProjectDocument, baseParts: string[]): string {
  const parts = [...baseParts];
  if (isLegalHold(doc)) parts.push('legal hold');
  const ocr = ocrStatusLabel(readOcrMeta(doc));
  if (ocr) parts.push(ocr);
  return parts.filter(Boolean).join(' · ');
}

export function isCanonicalDocument(doc: ProjectDocument): boolean {
  return doc.source === 'canonical';
}
