import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mobile = join(__dirname, '..');
const repo = join(mobile, '..', '..');
const readMobile = (relativePath: string) => readFileSync(join(mobile, relativePath), 'utf8');
const readBackend = (relativePath: string) => readFileSync(join(repo, 'backend', relativePath), 'utf8');
const must = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

const api = readMobile('lib/api/os.ts');
const sheet = readMobile('components/renova/BankStatementImportSheet.tsx');
const router = readBackend('app/api/v1/router.py');
const endpoint = readBackend('app/api/v1/bank_statements.py');
const service = readBackend('app/services/bank_statement_integrity.py');

must(api.includes('match_token?: string | null'), 'import response exposes signed match token');
must(api.includes('payment_ids: string[], match_token: string'), 'confirm API requires match token');
must(api.includes('JSON.stringify({ payment_ids, match_token })'), 'confirm request sends payment ids and token together');

must(sheet.includes("const confirmableIds = role === 'customer' ? pendingIds : []"), 'only customer sees bank confirmation path');
must(sheet.includes('const matchToken = res.match_token'), 'sheet keeps server match token');
must(sheet.includes('confirmableIds, matchToken'), 'sheet confirms the exact signed match set');
must(sheet.includes('expenses_replayed'), 'sheet distinguishes new and replayed expenses');
must(sheet.includes('replayed_count'), 'sheet reports replayed payment confirmations');

must(router.indexOf('include_router(bank_statements.router)') < router.indexOf('include_router(export.router)'), 'canonical bank routes precede legacy routes');
must(endpoint.includes('UserRole.customer') && endpoint.includes('user.id != project.customer_id'), 'bank confirmation is customer-owner only');
must(endpoint.includes('verify_match_token('), 'confirmation verifies signed match evidence');
must(endpoint.includes('annotate_statement_rows('), 'statement rows receive canonical identities before matching');

must(service.includes('bank_statement:v1:'), 'bank expenses store stable source markers');
must(service.includes('query = query.with_for_update()'), 'bank expense and payment mutations use row locks');
must(service.includes('PaymentEvent(') && service.includes('evidence_type="bank_statement"'), 'payment transition records bank evidence');
must(service.includes('expenses_replayed'), 'expense import exposes replay result');
must(service.includes('PaymentStatus.confirmed') && service.includes('budget.refresh_budget_facts'), 'confirmation updates canonical payment and budget fact');
must(service.includes('outbox.enqueue('), 'bank side effects are durable');

console.log('bankStatementIntegrity.test OK');
