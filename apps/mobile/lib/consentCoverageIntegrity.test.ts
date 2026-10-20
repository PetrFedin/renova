import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

const report = read('backend/app/services/client_consent_coverage_service.py');
const route = read('backend/app/api/v1/approvals.py');
const mobileApi = read('apps/mobile/lib/api/os.ts');
const panel = read('apps/mobile/components/renova/CustomerConsentCoveragePanel.tsx');
const screen = read('apps/mobile/components/screens/OsBudgetScreen.tsx');
const tests = read('backend/tests/test_client_consent_coverage.py');

assert.match(route, /@router\.get\("\/\{project_id\}\/consent-coverage"\)/);
const routeTail = route.slice(route.indexOf('async def customer_consent_coverage('));
assert.ok(routeTail.indexOf('await require_project(') < routeTail.indexOf('consent_coverage_snapshot('));
assert.match(routeTail, /project\.customer_id != user\.id/);
assert.match(routeTail, /HTTPException\(403/);

assert.match(report, /complete_customer_consent_proven": False/);
assert.match(report, /consent_status": "not_verifiable"/);
assert.match(report, /"read_consistency": "best_effort_not_an_atomic_snapshot"/);
assert.match(report, /"financial_totals_are_not_additive": True/);
assert.match(report, /"amounts_are_not_proof_of_customer_consent": True/);
assert.match(report, /source_refs = \(/);
assert.match(report, /invalid = \[kind for kind, key, known in source_refs/);
assert.match(report, /expense\.status/);
assert.match(report, /status == "confirmed"/);
assert.doesNotMatch(report, /await db\.commit\(|await db\.flush\(|db\.add\(/, 'Evidence audit must never mutate the financial ledger');

assert.match(mobileApi, /customerConsentCoverage:/);
assert.match(mobileApi, /req<CustomerConsentCoverage>/);
assert.doesNotMatch(mobileApi, /cachedGet<CustomerConsentCoverage>/, 'Do not present an old consent state as current');
assert.match(screen, /role === 'customer'/);
assert.match(screen, /CustomerConsentCoveragePanel userId=\{user\.id\} projectId=\{activeProject\.id\}/);
assert.match(panel, /complete_customer_consent_proven|Полное индивидуальное согласие/);
assert.match(panel, /Проверка недоступна\. Это не означает/);
assert.match(panel, /report\.scan_truncated \|\| report\.items_limited/);
assert.match(panel, /useProjectDataReload\(reload\)/);

assert.match(tests, /test_audit_separates_payment_from_consent_and_detects_foreign_links/);
assert.match(tests, /test_customer_coverage_route_denies_contractor_and_cross_project_user/);
assert.match(tests, /test_audit_checks_all_source_links_not_only_first/);

console.log('Customer consent evidence coverage contract passed');
