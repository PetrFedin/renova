import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (f: string) => fs.readFileSync(path.join(root, f), 'utf8');
const model = read('backend/app/models/client_scope_consent.py');
const migration = read('backend/alembic/versions/x13clientscopecons01_customer_scope_version_authorization.py');
const service = read('backend/app/services/client_scope_consent_service.py');
const workService = read('backend/app/services/work_order_service.py');
const routes = read('backend/app/api/v1/client_scope_consents.py');
const composition = read('backend/app/api/v1/router.py');
const api = read('apps/mobile/lib/api/workOrders.ts');
const panel = read('apps/mobile/components/renova/WorkOrderScopeConsentPanel.tsx');
const screen = read('apps/mobile/components/screens/WorkOrderDetailScreen.tsx');
const tests = read('backend/tests/test_client_scope_consent.py');
const postgres = read('backend/tests/test_client_scope_consent_postgres.py');

for (const token of ['client_scope_versions', 'client_scope_decisions', 'client_financial_authorizations']) {
  assert.match(model, new RegExp(token));
  assert.match(migration, new RegExp(token));
}
assert.match(migration, /down_revision = "x12projectrefund01"/);
assert.match(model, /Numeric\(14, 2\)/);
assert.match(model, /committed_amount <= amount_cap/);
assert.match(model, /consumed_amount <= committed_amount/);
assert.match(model, /uq_client_scope_one_decision/);
assert.match(service, /scope_quantity_price_cap_mismatch/);
assert.match(service, /scope_work_budget_mismatch/);
assert.match(service, /scope_specialist_identity_incomplete/);
assert.match(service, /scope_stale_work_order/);
assert.match(service, /scope_digest_mismatch/);
assert.match(service, /scope_version_superseded/);
assert.match(service, /scope_decision_customer_required/);
assert.match(service, /if actor.id != project.customer_id/);
assert.match(service, /scope_snapshot_integrity_failed/);
assert.match(service, /scope_decision_final_conflict/);
assert.match(service, /client_request_id/);
assert.match(service, /scope_already_authorized/);
assert.match(service, /outbox.enqueue/);
assert.match(service, /"linked_payments_qualified":False/);
assert.match(workService, /work_order_detailed_scope_not_approved/);
assert.match(workService, /ClientScopeDecision\.customer_id == user_id/);
assert.match(workService, /ClientFinancialAuthorization\.amount_cap == newest\.amount_cap/);

assert.match(composition, /api_router\.include_router\(client_scope_consents\.router\)/);
assert.match(routes, /scope-versions/);
assert.match(routes, /user\.id != project\.customer_id/);
assert.match(routes, /user\.id != project\.contractor_id/);
assert.match(routes, /"financial_allocations_enforced": False/);

assert.match(api, /listScopeVersions:/);
assert.match(api, /proposeScopeVersion:/);
assert.match(api, /decideScopeVersion:/);
const consentOnly = api.slice(api.indexOf('listScopeVersions:'), api.indexOf('listWorkOrders:'));
assert.doesNotMatch(consentOnly, /enqueue\(|offlineQueue|isQueueableWriteError/, 'Scope consent must never queue a speculative signature offline');
assert.match(panel, /disclosuresChecked/);
assert.match(panel, /generation\.current/);
assert.match(panel, /setVersions\(null\)/);
assert.match(panel, /scope-/);
assert.match(panel, /SHA-256/);
assert.match(panel, /role === 'customer'/);
assert.match(panel, /current\?\.decision === 'pending'/);
assert.match(panel, /api\.decideScopeVersion/);
assert.match(screen, /<WorkOrderScopeConsentPanel/);

for (const token of [
  'test_customer_approves_exact_digest',
  'test_foreign_customer_or_contractor_cannot_manufacture_approval',
  'test_duplicate_request_is_replay_only',
  'test_superseded_version_bad_digest',
  'test_stale_work_budget_and_changed_scope',
  'test_outbox_failure_rolls_back',
  'test_canonical_work_order_transition_cannot_bypass',
  'test_db_enforces_authorization_limits',
]) assert.ok(tests.includes(token), 'missing backend acceptance: ' + token);

assert.match(postgres, /test_double_customer_click_one_scope_one_authorization_postgresql/);
assert.match(postgres, /Project\.id == project_id/);
assert.match(postgres, /replayed/);
assert.match(postgres, /ClientFinancialAuthorization/);

console.log('Client scope version, customer decision and UI contract passed');
