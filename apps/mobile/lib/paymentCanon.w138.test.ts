/** W138: один канон оплаты — PaymentDetailSheet; finance-center не confirm напрямую */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const sheet = readFileSync(join(mobile, 'components/renova/PaymentDetailSheet.tsx'), 'utf8');
const budget = readFileSync(join(mobile, 'components/screens/OsBudgetScreen.tsx'), 'utf8');
const payApi = readFileSync(join(mobile, 'lib/api/payments.ts'), 'utf8');
const push = readFileSync(join(mobile, 'lib/pushLinks.ts'), 'utf8');
const catchAll = readFileSync(join(mobile, 'lib/resolveCatchAllSlug.ts'), 'utf8');
const snap = readFileSync(join(mobile, 'lib/domain/buildProjectOsSnapshot.ts'), 'utf8');

// confirmPayment только в sheet (+ api wrapper)
const confirmCalls = (sheet.match(/confirmPayment\(/g) || []).length;
console.assert(confirmCalls >= 1, 'sheet calls confirmPayment');
console.assert(payApi.includes('transfer_ack'), 'API sends transfer_ack');
console.assert(sheet.includes('transfer_ack'), 'sheet passes transfer_ack');
console.assert(sheet.includes('внешнего перевода') || sheet.includes('внешний перевод'), 'honest external-transfer copy');

console.assert(budget.includes('openPaymentParam'), 'budget auto-opens sheet');
console.assert(push.includes("openPayment: '1'"), 'finance-center opens sheet');
console.assert(catchAll.includes("openPayment: '1'"), 'slug finance-center opens sheet');
console.assert(snap.includes("openPayment: '1'"), 'home Оплатить opens sheet');

console.log('paymentCanon.w138.test OK');
