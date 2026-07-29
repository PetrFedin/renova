import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const api = fs.readFileSync(path.join(root, 'apps/mobile/lib/api/payments.ts'), 'utf8');
const sheet = fs.readFileSync(path.join(root, 'apps/mobile/components/renova/PaymentDetailSheet.tsx'), 'utf8');
const route = fs.readFileSync(path.join(root, 'backend/app/api/v1/payment_disputes.py'), 'utf8');
const service = fs.readFileSync(path.join(root, 'backend/app/services/payment_dispute_service.py'), 'utf8');
const reversal = fs.readFileSync(path.join(root, 'backend/app/services/payment_reversal_service.py'), 'utf8');
const ledger = fs.readFileSync(path.join(root, 'backend/app/services/expense_ledger_service.py'), 'utf8');

assert.match(api, /disputePayment:/, 'Mobile API must expose the canonical dispute route');
const disputeApi = api.slice(api.indexOf('disputePayment:'));
assert.doesNotMatch(disputeApi, /offlineQueue|enqueue\(/, 'Payment disputes must never enter the offline queue');

assert.match(sheet, /const canDispute = isCustomer && !readOnly/, 'Only an editable customer surface may open a dispute');
assert.match(sheet, /\['confirmed', 'paid_unverified'\]\.includes\(payment\.status\)/, 'Only settled or acknowledged payments may be disputed');
assert.match(sheet, /variant="dangerOutline"[\s\S]*title="Оспорить оплату"|title="Оспорить оплату"[\s\S]*variant="dangerOutline"/, 'Dispute entry must use destructive outline hierarchy');
assert.match(sheet, /title="Подтвердить спор"[\s\S]*variant="danger"/, 'Final dispute action must use filled danger hierarchy');
assert.match(sheet, /mutation === 'dispute'/, 'Dispute loading state must be exact');
assert.match(sheet, /disputeReason\.trim\(\)\.length/, 'The reason must be visible and validated');

assert.match(route, /user\.role != UserRole\.customer/, 'Server route must enforce customer-only access');
assert.match(service, /PaymentStatus\.confirmed, PaymentStatus\.paid_unverified/, 'Allowed source states must be explicit');
assert.match(service, /evidence_type="customer_dispute"/, 'Dispute must write canonical evidence');
assert.match(service, /expense\.status = "disputed"/, 'Linked financial facts must follow the dispute state');
assert.match(service, /recalculate_existing_expense_facts/, 'Budget recalculation must preserve terminal ledger statuses');
assert.match(reversal, /PaymentStatus\.confirmed, PaymentStatus\.disputed/, 'Provider refund must close an open dispute');
assert.match(reversal, /recalculate_existing_expense_facts/, 'Refund must not re-hydrate disputed receipt facts');
assert.doesNotMatch(ledger, /expense_from_receipt|expense_from_payment|refresh_budget_facts/, 'Status-preserving recalculation must not recreate source facts');

console.log('Payment dispute integrity contract passed');
