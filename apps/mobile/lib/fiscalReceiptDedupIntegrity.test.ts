import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mobile = join(__dirname, '..');
const repo = join(mobile, '..', '..');
const readBackend = (relativePath: string) => readFileSync(join(repo, 'backend', relativePath), 'utf8');
const must = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

const dedup = readBackend('app/services/fiscal_receipt_dedup_service.py');
const idempotency = readBackend('app/services/client_write_idempotency.py');

must(dedup.includes('select(Project.id).where(Project.id == project_id)'), 'fiscal scan locks the route project');
must(dedup.includes('query = query.with_for_update()'), 'fiscal scan uses a database row lock');
must(dedup.includes('Receipt.project_id == project_id'), 'fiscal identity is project scoped');
must(dedup.includes('Receipt.fn == str(fn)') && dedup.includes('Receipt.fd == str(fd)'), 'FN and FD form canonical fiscal identity');
must(dedup.includes('Receipt.qr_raw == normalized_raw'), 'raw QR is fallback identity');
must(dedup.includes('Receipt.id != exclude_receipt_id'), 'candidate never matches itself');
must(dedup.includes('fiscal_receipt_identity_conflict'), 'same identity with another amount is blocked');
must(dedup.includes('await budget.delete_receipt_expenses('), 'duplicate expense ledger is removed');
must(dedup.includes('await db.delete(candidate)'), 'duplicate receipt candidate is removed');
must(dedup.includes('await budget.refresh_budget_facts('), 'budget is reconciled after collapse');

const collapseIndex = idempotency.indexOf('if scope == "receipt.scan":');
const prepareIndex = idempotency.indexOf('prepared_side_effects = await prepare_client_write_side_effects(');
must(collapseIndex >= 0 && prepareIndex > collapseIndex, 'fiscal duplicate collapses before side-effect preparation');
must(idempotency.includes('_commit_duplicate_mapping('), 'new request ledger maps to canonical receipt');
must(idempotency.includes('return False, canonical_entity_id'), 'duplicate returns replay semantics');
must(idempotency.includes('canonical_entity_id=duplicate_id'), 'duplicate mapping uses canonical receipt ID');

console.log('fiscalReceiptDedupIntegrity.test OK');
