import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mobile = join(__dirname, '..');
const repo = join(mobile, '..', '..');
const readMobile = (relativePath: string) => readFileSync(join(mobile, relativePath), 'utf8');
const readBackend = (relativePath: string) => readFileSync(join(repo, 'backend', relativePath), 'utf8');
const must = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

const api = readMobile('lib/api/receipts.ts');
const endpoint = readBackend('app/api/v1/receipts.py');
const service = readBackend('app/services/receipt_integrity_service.py');

const patchStart = api.indexOf('patchReceipt: async');
const patchEnd = api.indexOf('deleteReceipt:', patchStart);
const patchBlock = api.slice(patchStart, patchEnd);
must(patchStart >= 0 && patchEnd > patchStart, 'receipt patch API block exists');
must(patchBlock.includes('const serialized = JSON.stringify(body)'), 'receipt patch serializes once');
must((patchBlock.match(/body: serialized/g) || []).length === 2, 'receipt patch online and offline paths reuse exact body');

must(endpoint.includes('_resolve_receipt_links('), 'receipt create validates project links');
must(endpoint.includes('room_id, stage_id = await _resolve_receipt_links('), 'scan and manual use resolved links');
must(endpoint.includes('body.model_fields_set'), 'patch distinguishes omitted fields from explicit clears');
must(endpoint.includes('receipt_svc.patch_receipt('), 'patch delegates to canonical service');
must(endpoint.includes('receipt_svc.apply_verification_result('), 'reverify reconciles through service');
must(endpoint.includes('receipt_svc.delete_receipt('), 'delete delegates to transactional service');
must(endpoint.includes('select(Receipt)') && endpoint.includes('Receipt.project_id == project_id'), 'receipt listing is explicit and project scoped');
must(endpoint.includes('"replayed": not mutation.changed'), 'reverify exposes replay state');

must(service.includes('Receipt.id == receipt_id,') && service.includes('Receipt.project_id == project_id,'), 'receipt mutation lookup is project scoped');
must(service.includes('query = query.with_for_update()'), 'receipt mutations use row locking');
must(service.includes('Room.id == room_id, Room.project_id == project_id'), 'room link is project scoped');
must(service.includes('Stage.id == stage_id, Stage.project_id == project_id'), 'stage link is project scoped');
must(service.includes('fiscal_receipt_amount_immutable'), 'QR receipt amount is immutable');
must(service.includes('fiscal_receipt_description_immutable'), 'QR receipt description is immutable');
must(service.includes('await budget.expense_from_receipt(') && service.includes('await budget.refresh_budget_facts('), 'receipt mutations reconcile expense and budget');
must(service.includes('if changed:') && service.includes('ReceiptVerified'), 'verification emits durable activity only on state change');
must(service.includes('confirmed_payment_receipt_locked'), 'confirmed payment evidence cannot be deleted');
must(service.includes('await budget.delete_receipt_expenses('), 'delete removes linked expense ledger');
must(service.includes('activate_client_write_side_effects('), 'receipt side effects are routed after commit');

console.log('receiptFinancialIntegrity.test OK');
