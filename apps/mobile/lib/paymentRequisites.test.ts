/** unit: npx tsx apps/mobile/lib/paymentRequisites.test.ts */
import assert from 'node:assert/strict';
import { buildPaymentRequisites } from './paymentRequisites';

const empty = buildPaymentRequisites({ amount: 150000, title: 'Этап черновые' });
assert.equal(empty.hasBankDetails, false);
assert.ok(empty.missingHint);
assert.ok(!empty.text.includes('2202'));
assert.ok(empty.text.includes('150'));

const filled = buildPaymentRequisites({
  recipientName: 'ИП Иванов',
  paymentRequisites: 'СБП · +7 900 000-00-00\nТинькофф',
  amount: 50000,
  title: 'Акт №3',
});
assert.equal(filled.hasBankDetails, true);
assert.equal(filled.missingHint, null);
assert.ok(filled.text.includes('ИП Иванов'));
assert.ok(filled.text.includes('СБП'));
assert.ok(!filled.text.includes('2202 2065'));

console.log('paymentRequisites.test OK');
