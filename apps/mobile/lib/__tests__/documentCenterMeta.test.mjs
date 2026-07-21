/**
 * node apps/mobile/lib/__tests__/documentCenterMeta.test.mjs
 */
function ocrStatusLabel(ocr, mode) {
  if (!ocr?.status || ocr.status === 'none') return null;
  const conf = typeof ocr.confidence === 'number' ? ` ${Math.round(ocr.confidence * 100)}%` : '';
  const suggested = ocr.suggested_type ? ` → ${ocr.suggested_type}` : '';
  if (ocr.status === 'done') {
    const m = (mode || '').toLowerCase();
    if (m === 'demo') return `OCR демо-классификация${suggested}${conf}`;
    if (m === 'local') return `OCR локальная классификация${suggested}${conf}`;
    return `OCR классификация${suggested}${conf}`;
  }
  if (ocr.status === 'queued') return 'OCR в очереди';
  if (ocr.status === 'failed') return 'OCR ошибка';
  return `OCR ${ocr.status}`;
}
function documentCenterSubtitle(doc, baseParts, ocrMode) {
  const parts = [...baseParts];
  if (doc.meta?.legal_hold) parts.push('legal hold');
  const ocr = ocrStatusLabel(doc.meta?.ocr, ocrMode);
  if (ocr) parts.push(ocr);
  return parts.filter(Boolean).join(' · ');
}

const doc = {
  meta: { legal_hold: true, ocr: { status: 'done', suggested_type: 'contract', confidence: 0.82 } },
};
const local = documentCenterSubtitle(doc, ['canonical', 'active'], 'local');
if (!local.includes('legal hold') || !local.includes('локальная') || local.includes('демо') || !local.includes('contract')) {
  console.error('FAIL local', local);
  process.exit(1);
}
const demo = documentCenterSubtitle(doc, ['canonical'], 'demo');
if (!demo.includes('демо-классификация')) {
  console.error('FAIL demo', demo);
  process.exit(1);
}
const noMode = documentCenterSubtitle(doc, ['canonical'], null);
if (noMode.includes('демо')) {
  console.error('FAIL no hardcoded demo', noMode);
  process.exit(1);
}
console.log('OK documentCenterMeta');
