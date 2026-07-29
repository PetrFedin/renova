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
const router = readBackend('app/api/v1/router.py');
const endpoint = readBackend('app/api/v1/expense_mutations.py');
const service = readBackend('app/services/expense_integrity_service.py');

const patchStart = api.indexOf('patchOsExpense: async');
const patchEnd = api.indexOf('reportDaily:', patchStart);
const patchBlock = api.slice(patchStart, patchEnd);
must(patchStart >= 0 && patchEnd > patchStart, 'expense patch client block exists');
must(patchBlock.includes('const serialized = JSON.stringify(body)'), 'expense patch serializes once');
must((patchBlock.match(/body: serialized/g) || []).length === 2, 'online and offline patch reuse exact body');

must(router.indexOf('include_router(expense_mutations.router)') < router.indexOf('include_router(os.router)'), 'canonical expense routes precede legacy OS routes');
must(endpoint.includes('body.model_fields_set'), 'endpoint distinguishes omitted fields from explicit null');
must(endpoint.includes('room_id_supplied="room_id" in supplied'), 'room mutation is presence-aware');
must(endpoint.includes('stage_id_supplied="stage_id" in supplied'), 'stage mutation is presence-aware');

must(service.includes('query = query.with_for_update()'), 'expense mutations lock the project-scoped row');
must(service.includes('Expense.id == expense_id') && service.includes('Expense.project_id == project_id'), 'expense lookup is project scoped');
must(service.includes('"receipt", "payment", "purchase", "material_pick"'), 'canonical source-linked expenses are locked');
must(service.includes('bank_statement:v1:'), 'bank statement source is recognized');
must(service.includes('bank_expense_amount_immutable') && service.includes('bank_expense_title_immutable'), 'bank source fields are immutable');
must(service.includes('expense.status == "deleted"') && service.includes('replayed=True'), 'delete retry is replay safe');
must(service.includes('outbox.enqueue(') && service.includes('ExpenseUpdated') && service.includes('ExpenseRemoved'), 'expense audit effects are durable');

console.log('expenseMutationIntegrity.test OK');
