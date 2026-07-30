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
const verifier = readBackend('app/services/fns/receipt_verify.py');
const truthEvents = readBackend('app/services/fns/receipt_truth_events.py');

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

must(/Receipt\.id\s*==\s*receipt_id[\s\S]*Receipt\.project_id\s*==\s*project_id/.test(service), 'receipt mutation lookup is project scoped');
must(service.includes('query = query.with_for_update()'), 'receipt mutations use row locking');
must(/Room\.id\s*==\s*room_id[\s\S]*Room\.project_id\s*==\s*project_id/.test(service), 'room link is project scoped');
must(/Stage\.id\s*==\s*stage_id[\s\S]*Stage\.project_id\s*==\s*project_id/.test(service), 'stage link is project scoped');
must(service.includes('fiscal_receipt_amount_immutable'), 'QR receipt amount is immutable');
must(service.includes('fiscal_receipt_description_immutable'), 'QR receipt description is immutable');
must(service.includes('await budget.expense_from_receipt(') && service.includes('await budget.refresh_budget_facts('), 'receipt mutations reconcile expense and budget');
must(service.includes('if not changed:') && service.includes('ReceiptVerified') && service.includes('ReceiptVerificationPending'), 'verification emits durable activity only after a real state change');
must(service.includes('verification_pending') && service.includes('verification_failed') && service.includes('normalized == "invalid"'), 'verification preserves exact provider states');
must(service.includes('next_status == "verified_live"'), 'only verified_live becomes fiscal evidence');
must(!service.includes('return "demo_verified"'), 'demo verification cannot be created');
must(service.includes('confirmed_payment_receipt_locked'), 'confirmed payment evidence cannot be deleted');
must(service.includes('await budget.delete_receipt_expenses('), 'delete removes linked expense ledger');
must(service.includes('activate_client_write_side_effects('), 'receipt side effects are routed after commit');

must(verifier.includes('"demo_verify_allowed": False'), 'FNS health never advertises demo verification');
must(verifier.includes('response.json()') && verifier.includes('_provider_amounts'), 'provider JSON and amount evidence are validated');
must(verifier.includes('VERIFICATION_PENDING') && verifier.includes('VERIFICATION_FAILED') && verifier.includes('INVALID'), 'provider failures have explicit states');
must(truthEvents.includes('_is_fiscal_receipt') && truthEvents.includes('!= "MANUAL"'), 'manual receipts are excluded from fiscal truth guard');

console.log('receiptFinancialIntegrity.test OK');
