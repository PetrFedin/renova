/**
 * node apps/mobile/lib/__tests__/documentCenterMeta.test.mjs
 * (дублируем логику без TS import — зеркало для CI без ts-node)
 */
function readOcrMeta(doc) {
  const raw = doc.meta?.ocr;
  if (!raw || typeof raw !== 'object') return null;
  return raw;
}
function isLegalHold(doc) {
  return Boolean(doc.meta?.legal_hold);
}
function ocrStatusLabel(ocr) {
  if (!ocr?.status || ocr.status === 'none') return null;
  const conf = typeof ocr.confidence === 'number' ? ` ${Math.round(ocr.confidence * 100)}%` : '';
  const suggested = ocr.suggested_type ? ` → ${ocr.suggested_type}` : '';
  if (ocr.status === 'done') return `OCR ок${suggested}${conf}`;
  if (ocr.status === 'queued') return 'OCR в очереди';
  if (ocr.status === 'failed') return 'OCR ошибка';
  return `OCR ${ocr.status}`;
}
function documentCenterSubtitle(doc, baseParts) {
  const parts = [...baseParts];
  if (isLegalHold(doc)) parts.push('legal hold');
  const ocr = ocrStatusLabel(readOcrMeta(doc));
  if (ocr) parts.push(ocr);
  return parts.filter(Boolean).join(' · ');
}

const doc = {
  meta: { legal_hold: true, ocr: { status: 'done', suggested_type: 'contract', confidence: 0.82 } },
};
const s = documentCenterSubtitle(doc, ['canonical', 'active']);
if (!s.includes('legal hold') || !s.includes('OCR ок') || !s.includes('contract')) {
  console.error('FAIL', s);
  process.exit(1);
}
console.log('OK documentCenterMeta');
