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
  const suggested = ocr.suggested_type ? ` → ${documentTypeLabel(ocr.suggested_type)}` : '';
  switch (ocr.status) {
    case 'queued':
      return 'OCR в очереди';
    case 'processing':
      return 'OCR…';
    case 'done':
    // Сервер называет тот же исход `suggested` (document_ocr_service.py);
    // раньше он падал в default и читался как «OCR suggested».
    case 'suggested':
      // W67 #29: stub ≠ распознанный документ
      return `OCR демо-классификация${suggested}${conf}`;
    case 'confirmed':
      return `OCR подтверждён${suggested}`;
    case 'unavailable':
      return 'OCR недоступен';
    case 'failed':
      return 'OCR ошибка';
    default:
      return `OCR ${ocr.status}`;
  }
}

/**
 * Тип документа по-русски.
 *
 * `DocumentType` на сервере — латинские значения (`receipt`, `acceptance_act`).
 * OCR-подсказка подставляла их в подпись как есть: «OCR демо-классификация →
 * receipt». Незнакомое значение возвращаем как есть — это диагностика, а не
 * молчание.
 */
export function documentTypeLabel(type: string): string {
  switch (type) {
    case 'acceptance_act': return 'акт приёмки';
    case 'design_package': return 'дизайн-пакет';
    case 'receipt': return 'чек';
    case 'estimate': return 'смета';
    case 'contract': return 'договор';
    case 'invoice': return 'счёт';
    case 'warranty': return 'гарантия';
    case 'upload': return 'загрузка';
    case 'other': return 'прочее';
    default: return type;
  }
}

/**
 * Состояние документа по-русски.
 *
 * `DocumentStatus` на сервере — латинские значения, и карточка канонического
 * документа показывала «Документ · active · v1». Покрыты все значения
 * перечисления плюс `submitting` из project_document_service.
 */
export function documentStatusLabel(status: string | null | undefined): string | null {
  switch (status) {
    case 'draft': return 'Черновик';
    case 'active': return 'Действует';
    case 'superseded': return 'Заменён';
    case 'archived': return 'В архиве';
    case 'deleted': return 'Удалён';
    case 'submitting': return 'Отправляется';
    case 'ready': return 'Готов';
    case 'verified': return 'Проверен';
    case 'unverified': return 'Не проверен';
    default: return status || null;
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
