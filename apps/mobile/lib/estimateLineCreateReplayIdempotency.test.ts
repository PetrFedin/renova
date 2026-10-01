/**
 * #406: estimate-line create must be replay-safe against a lost-response
 * offline-queue retry — the same fix already applied to floor-plan/furniture
 * create (see floorPlanReplayIdempotency.test.ts) and change-order create
 * (see changeOrderCreateIdempotency.test.ts).
 *
 * Run: npx tsx apps/mobile/lib/estimateLineCreateReplayIdempotency.test.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mobile = join(__dirname, '..');
const repo = join(mobile, '..', '..');
const readMobile = (relativePath: string) => readFileSync(join(mobile, relativePath), 'utf8');
const readBackend = (relativePath: string) => readFileSync(join(repo, 'backend', relativePath), 'utf8');
const must = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

const estimateApi = readMobile('lib/api/estimate.ts');
const addForm = readMobile('components/renova/AddEstimateLineForm.tsx');
const estimateEndpoint = readBackend('app/api/v1/estimate.py');
const estimateService = readBackend('app/services/estimate_service.py');
const idempotency = readBackend('app/services/client_write_idempotency.py');

function block(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  must(start >= 0 && end > start, `block markers found: "${startMarker}" .. "${endMarker}"`);
  return source.slice(start, end);
}

// --- #406: estimate-line create replay identity (mobile) -------------------

const createLineBlock = block(estimateApi, 'addEstimateLine: async', 'materialStats:');
must(createLineBlock.includes('const requestBody = JSON.stringify(body)'), 'mobile serializes the line body once, before the first attempt');
must((createLineBlock.match(/body: requestBody/g) || []).length === 2, 'online request and queued offline replay send the identical serialized line body');
must(createLineBlock.includes('isQueueableWriteError(e)') || createLineBlock.includes('e.status !== 429'), '429 is replay-safe and queues like transport/5xx, matching floor-plan/furniture create');
must(createLineBlock.includes('!isQueueableWriteError(e)') || createLineBlock.includes('e.status >= 400 && e.status < 500'), 'deterministic 4xx (except 429) is authoritative and must not be queued');

// The form is the canonical minter: it keeps one client_request_id across
// the whole submit/offline-queue/retry lifecycle so a lost response after a
// server-side commit replays into the original line instead of a duplicate.
must(addForm.includes("requestIdRef = useRef(createClientRequestId('estimate-line'))"), 'form mints a stable estimate-line request id');
must(addForm.includes('client_request_id: requestIdRef.current'), 'form sends the request id with every submit, including retries');
const submitBlock = block(addForm, 'async function submit()', 'if (collapsed && !open)');
must(submitBlock.includes('rotateRequestId()'), 'form rotates the request id only after success or a durably queued write');
must(
  submitBlock.indexOf('if (isOfflineQueued(error))') < submitBlock.indexOf('rotateRequestId()'),
  'offline-queued path rotates the id only after the queued write is durable, not before',
);
// A deterministic failure (validation/authorization, the `else` branch) must
// NOT rotate the id before that branch — otherwise a manual retry after a
// real error would mint a new key and could double-create if the first
// attempt actually landed despite the client seeing an error.
const elseBranch = submitBlock.slice(submitBlock.indexOf('} else {'), submitBlock.indexOf('} finally {'));
must(!elseBranch.includes('rotateRequestId()'), 'a deterministic (non-offline-queued) failure must not rotate the request id before retry');

// --- #406: backend contract -------------------------------------------------

must(estimateEndpoint.includes('client_request_id: str | None'), 'backend estimate-line schema accepts a request id');
must(estimateEndpoint.includes('create_or_replay_estimate_line('), 'estimate-line create routes through the canonical replay-safe service function');
must(estimateEndpoint.includes('"idempotency_conflict"'), 'estimate-line create surfaces a typed conflict for a reused id with a different payload');
must(
  estimateService.includes('ESTIMATE_LINE_CREATE_SCOPE = "estimate_line.create"'),
  'backend has a stable scope for estimate-line create',
);
must(
  estimateService.includes('replay_entity_id(') && estimateService.includes('commit_client_write('),
  'estimate-line create replays before an atomic commit',
);
must(
  estimateService.includes('sync_project_budget_planned(db, project_id)'),
  'budget_planned resync happens inside the same replay-guarded create path, not before it',
);
must(idempotency.includes('class IdempotencyConflict'), 'shared idempotency ledger defines IdempotencyConflict');

console.log('estimateLineCreateReplayIdempotency.test.ts: all assertions passed');
