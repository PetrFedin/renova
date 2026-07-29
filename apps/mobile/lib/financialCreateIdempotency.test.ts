import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const repo = join(mobile, '..', '..');
const src = (relativePath: string) => readFileSync(join(mobile, relativePath), 'utf8');
const backend = (relativePath: string) => readFileSync(join(repo, 'backend', relativePath), 'utf8');
const must = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

const ids = src('lib/clientRequestId.ts');
const paymentForm = src('components/renova/CreatePaymentForm.tsx');
const expenseForm = src('components/renova/ManualExpenseForm.tsx');
const estimateForm = src('components/renova/AddEstimateLineForm.tsx');
const receiptsApi = src('lib/api/receipts.ts');

must(ids.includes('MAX_REQUEST_ID_LENGTH = 80') && ids.includes('createClientRequestId'), 'bounded request id generator');
for (const [name, body, scope] of [
  ['payment', paymentForm, 'payment'],
  ['manual expense', expenseForm, 'receipt-manual'],
  ['estimate line', estimateForm, 'estimate-line'],
] as const) {
  must(body.includes('requestIdRef = useRef(createClientRequestId'), `${name} keeps request id in ref`);
  must(body.includes('client_request_id: requestIdRef.current'), `${name} sends request id`);
  must(body.includes(`createClientRequestId('${scope}')`), `${name} rotates scoped request id`);
}
must(expenseForm.indexOf('rotateRequestId();') > expenseForm.indexOf("notifyOfflineQueued('Расход без чека')"), 'manual expense rotates after durable queue');
must(estimateForm.indexOf('rotateRequestId();') > estimateForm.indexOf("notifyOfflineQueued('Строка сметы')"), 'estimate rotates after durable queue');
must(receiptsApi.includes("client_request_id: client_request_id ?? createClientRequestId('receipt-manual')"), 'manual API fallback request id');
must(receiptsApi.includes("client_request_id: client_request_id ?? createClientRequestId('receipt-scan')"), 'scan API fallback request id');
must(receiptsApi.includes('const serialized = JSON.stringify(body)'), 'offline queue reuses exact serialized request');

const ledgerModel = backend('app/models/client_write_request.py');
const ledgerService = backend('app/services/client_write_idempotency.py');
const migration = backend('alembic/versions/w5_client_write_idempotency.py');
const paymentApi = backend('app/api/v1/payments.py');
const receiptApi = backend('app/api/v1/receipts.py');
const estimateApi = backend('app/api/v1/estimate.py');
const estimateService = backend('app/services/estimate_service.py');
const schemas = backend('app/schemas/project.py');

must(ledgerModel.includes('UniqueConstraint(') && ledgerModel.includes('uq_client_write_request'), 'database unique request scope');
must(ledgerService.includes('canonical_payload_hash') && ledgerService.includes('except IntegrityError'), 'payload conflict and race rollback');
must(ledgerService.includes('await db.rollback()') && ledgerService.includes('return False, existing.entity_id'), 'concurrent loser returns winner');
must(migration.includes('down_revision = "w4jtipurge01"') && migration.includes('client_write_requests'), 'idempotency migration chain');
must(schemas.includes('client_request_id: str | None'), 'payment request schema');
must(paymentApi.includes('PAYMENT_CREATE_SCOPE') && paymentApi.includes('if created and project.customer_id'), 'payment replay skips duplicate notification');
must(receiptApi.includes('RECEIPT_SCAN_SCOPE') && receiptApi.includes('RECEIPT_MANUAL_SCOPE'), 'receipt scopes');
must(receiptApi.includes('idempotent_replay=True') && receiptApi.includes('commit_client_write'), 'receipt replay/atomic commit');
must(estimateApi.includes('room_id: str | None') && estimateApi.includes('category: str | None') && estimateApi.includes('notes: str | None'), 'estimate schema keeps form context');
must(estimateApi.includes('sync_project_budget_planned') && estimateApi.includes('commit_client_write'), 'estimate budget and ledger commit together');
must(estimateService.includes('room_id=data.get("room_id")') && estimateService.includes('category=data.get("category")') && estimateService.includes('notes=data.get("notes")'), 'estimate service persists context');
must(estimateService.includes('proposal_stale') && estimateService.includes('ensure_contract_draft') && estimateService.includes('csv_no_header'), 'extended estimate workflows preserved');

console.log('financialCreateIdempotency.test OK');
