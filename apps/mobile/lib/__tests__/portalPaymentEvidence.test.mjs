/**
 * node apps/mobile/lib/__tests__/portalPaymentEvidence.test.mjs
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '../..');

function must(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg);
    process.exit(1);
  }
}

const sheet = readFileSync(join(root, 'components/renova/PortalPaymentEvidenceSheet.tsx'), 'utf8');
must(sheet.includes('paid_unverified') || sheet.includes('ожидает проверки'), 'shows awaiting verification');
must(sheet.includes('uploading'), 'upload progress state');
must(sheet.includes('validate') || sheet.includes('Укажите дату'), 'validation');
must(sheet.includes('Повторить'), 'retry on network failure');
must(sheet.includes("disabled={busy}") || sheet.includes('step === \'uploading\''), 'disabled during upload');
must(!sheet.includes('status: \'confirmed\'') || sheet.includes('не подтверждает оплату автоматически'), 'no auto confirmed');
must(sheet.includes('Подтвердить оплату') && sheet.includes('Отклонить'), 'reviewer actions');
must(sheet.includes('reject_reason') || sheet.includes('Отклонено'), 'rejected resubmission UX');
must(sheet.includes('accessibilityLabel'), 'a11y labels');

const api = readFileSync(join(root, 'lib/api/payments.ts'), 'utf8');
must(api.includes('submitPaymentEvidence'), 'API submit');
must(api.includes('approvePaymentEvidence') && api.includes('rejectPaymentEvidence'), 'API review');
must(api.includes('Idempotency-Key'), 'idempotency header');

const portal = readFileSync(join(root, 'app/portal.tsx'), 'utf8');
must(portal.includes('PortalPaymentEvidenceSheet'), 'portal wires sheet');
must(portal.includes('Я перевёл'), 'portal CTA');

console.log('OK portalPaymentEvidence');
