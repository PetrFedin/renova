/** W138: один канон оплаты — PaymentDetailSheet; finance-center не confirm напрямую */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const sheet = readFileSync(join(mobile, 'components/renova/PaymentDetailSheet.tsx'), 'utf8');
const budget = readFileSync(join(mobile, 'components/screens/OsBudgetScreen.tsx'), 'utf8');
const payApi = readFileSync(join(mobile, 'lib/api/payments.ts'), 'utf8');
const push = readFileSync(join(mobile, 'lib/pushLinks.ts'), 'utf8');
const catchAll = readFileSync(join(mobile, 'lib/resolveCatchAllSlug.ts'), 'utf8');
const snap = readFileSync(join(mobile, 'lib/domain/buildProjectOsSnapshot.ts'), 'utf8');
const kpi = readFileSync(join(mobile, 'lib/domain/buildHomeKpiDetail.ts'), 'utf8');
const chat = readFileSync(join(mobile, 'components/renova/chat/ChatThreadView.tsx'), 'utf8');
const svc = readFileSync(join(mobile, '../../backend/app/services/payment_service.py'), 'utf8');
const yk = readFileSync(join(mobile, '../../backend/app/services/yookassa_service.py'), 'utf8');

console.assert((sheet.match(/confirmPayment\(/g) || []).length >= 1, 'sheet calls confirmPayment');
console.assert(payApi.includes('transfer_ack'), 'API sends transfer_ack');
console.assert(sheet.includes('transfer_ack'), 'sheet passes transfer_ack');
console.assert(sheet.includes('внешнего перевода') || sheet.includes('внешний перевод'), 'honest external-transfer copy');

console.assert(budget.includes('openPaymentParam'), 'budget auto-opens sheet');
console.assert(push.includes("openPayment: '1'"), 'finance-center opens sheet');
console.assert(catchAll.includes("openPayment: '1'"), 'slug finance-center opens sheet');
console.assert(snap.includes("openPayment: '1'"), 'home Оплатить opens sheet');
console.assert(kpi.includes("openPayment: '1'"), 'KPI Оплатить opens sheet');
console.assert(chat.includes("openPayment: '1'"), 'chat pay opens sheet');
console.assert(push.includes("case 'payment_pending'") && push.includes("openPayment: '1'"), 'push pending opens sheet');

// No other component calls confirmPayment(
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(tsx|ts)$/.test(name)) out.push(p);
  }
  return out;
}
const offenders: string[] = [];
for (const file of walk(join(mobile, 'components'))) {
  if (file.endsWith('PaymentDetailSheet.tsx')) continue;
  const src = readFileSync(file, 'utf8');
  if (/confirmPayment\s*\(/.test(src)) offenders.push(file);
}
console.assert(offenders.length === 0, 'confirmPayment only in sheet: ' + offenders.join(', '));

// YuKassa id at checkout must NOT be manual settlement proof
console.assert(!/has_yk|yookassa_payment_id.*transfer_ack|receipt_id or has_yk/.test(
  svc.slice(svc.indexOf('allow_without_settlement'), svc.indexOf('allow_without_settlement') + 400),
), 'manual confirm must not treat yookassa_id as proof');
console.assert(svc.includes('if not (receipt_id or transfer_ack)'), 'manual proof = receipt or ack');
console.assert(yk.includes('allow_without_settlement=True'), 'webhook uses machine settlement');

console.log('paymentCanon.w138.test OK');
