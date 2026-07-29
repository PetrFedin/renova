import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const api = fs.readFileSync(path.join(root, 'apps/mobile/lib/api/payments.ts'), 'utf8');
const sheet = fs.readFileSync(path.join(root, 'apps/mobile/components/renova/PaymentDetailSheet.tsx'), 'utf8');
const route = fs.readFileSync(path.join(root, 'backend/app/api/v1/payment_disputes.py'), 'utf8');
const service = fs.readFileSync(path.join(root, 'backend/app/services/payment_dispute_service.py'), 'utf8');

assert.match(api, /resolvePaymentDispute:/, 'Mobile API must expose dispute resolution');
const resolutionApi = api.slice(api.indexOf('resolvePaymentDispute:'));
assert.match(resolutionApi, /\/dispute\/resolve/, 'Resolution must use the canonical endpoint');
assert.doesNotMatch(resolutionApi, /offlineQueue|enqueue\(/, 'Dispute resolution must never enter the offline queue');
assert.doesNotMatch(resolutionApi, /target_status|status:/, 'Client must not choose the restored payment state');

assert.match(sheet, /const canResolveDispute = isCustomer && !readOnly && payment\.status === 'disputed'/, 'Only the customer may resolve an open dispute');
assert.match(sheet, /title="Отозвать спор"/, 'Disputed payment must expose a resolution action');
assert.match(sheet, /title="Подтвердить отзыв спора"/, 'Resolution requires a second deliberate action');
assert.match(sheet, /loading=\{mutation === 'resolveDispute'\}/, 'Resolution loading state must be exact');
assert.match(sheet, /resolutionNote\.trim\(\)\.length/, 'Resolution note must be visible and validated');
assert.match(sheet, /api\.resolvePaymentDispute/, 'UI must call the canonical resolution API');

assert.match(route, /PaymentDisputeResolutionIn/, 'Resolution payload must be schema validated');
assert.match(route, /user\.role != UserRole\.customer/, 'Resolution route must remain customer-only');
assert.match(service, /evidence_type="customer_dispute_resolution"/, 'Resolution must record canonical evidence');
assert.match(service, /target_status = PaymentStatus\(dispute_event\.old_status\)/, 'Server must derive target status from dispute evidence');
assert.match(service, /evidence_ref=dispute_event\.id/, 'Resolution must link back to the opening dispute event');
assert.match(service, /payment_dispute_expense_missing/, 'Confirmed restoration must fail when the canonical Expense is missing');
assert.match(service, /payment_dispute_expense_state_conflict/, 'Conflicting Expense state must block restoration');
assert.match(service, /payment_dispute_unverified_expense_conflict/, 'Unverified restoration must never retain a fabricated Expense');
assert.match(service, /expense\.status = "confirmed"/, 'Confirmed resolution restores the existing Expense');
assert.doesNotMatch(service, /expense_from_payment|expense_from_receipt/, 'Resolution must not fabricate a source financial fact');

console.log('Payment dispute resolution integrity contract passed');
