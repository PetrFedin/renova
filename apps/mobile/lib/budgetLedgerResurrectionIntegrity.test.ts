import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const service = fs.readFileSync(path.join(root, 'backend/app/services/budget_service.py'), 'utf8');
const legacy = fs.readFileSync(path.join(root, 'backend/app/services/budget_service_legacy.py'), 'utf8');

assert.match(service, /SOURCE_PROTECTED_EXPENSE_STATUSES = frozenset\(\{"disputed", "refund", "deleted"\}\)/, 'Protected ledger statuses must be explicit');
assert.match(service, /if is_source_protected_expense\(existing\):\s*return existing/, 'Receipt hydration must stop at protected evidence');
assert.match(service, /if expense and is_source_protected_expense\(expense\):\s*return expense/, 'Purchase hydration must stop at protected evidence');
assert.match(service, /not is_source_protected_expense\(row\)/, 'Stale purchase cleanup must retain protected evidence');
assert.match(service, /_SOURCE_STATUS_PRIORITY/, 'Duplicate resolution must be status aware');
assert.match(service, /keep = min\(rows, key=_expense_canonical_key\)/, 'Canonical duplicate selection must use evidence priority');
assert.match(service, /_merge_source_links\(keep, duplicate\)/, 'Canonical row must retain all source identities');
assert.match(service, /_legacy\._dedupe_linked_expenses = _dedupe_linked_expenses/, 'Legacy internal calls must use protected dedupe');
assert.match(service, /_legacy\.refresh_budget_facts = refresh_budget_facts/, 'All legacy callers must use the protected refresh entrypoint');
assert.match(service, /_ORIGINAL_REFRESH_BUDGET_FACTS/, 'Existing budget aggregation must remain the single implementation');
assert.doesNotMatch(service, /existing\.status = "confirmed" if rec\.fns_verified else "pending_receipt"[\s\S]{0,80}if is_source_protected_expense/, 'Protected check must precede receipt status mutation');
assert.match(legacy, /Expense\.status\.in_\(\("confirmed", "pending_receipt"\)\)/, 'Budget fact aggregation must exclude protected statuses');

console.log('Budget ledger resurrection integrity contract passed');
