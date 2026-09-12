import { dedupeJobsByIntent, type IntentDedupeJob } from './intentDedupe';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function job(
  id: string,
  body: string,
  overrides: Partial<IntentDedupeJob> = {},
): IntentDedupeJob {
  return {
    id,
    userId: 'user-a',
    method: 'POST',
    path: '/api/v1/projects/p/messages',
    body,
    ...overrides,
  };
}

// Two real taps may be byte-identical. Payload equality is never intent identity.
{
  const body = JSON.stringify({ text: 'same comment' });
  const result = dedupeJobsByIntent([job('q-1', body), job('q-2', body)]);
  assert(result.removed === 0, 'byte-identical jobs without a stable request id must both survive');
  assert(result.jobs.map((x) => x.id).join(',') === 'q-1,q-2', 'queue order must be preserved');
}

// Separate client intents survive even when their business payload is otherwise identical.
{
  const result = dedupeJobsByIntent([
    job('q-1', JSON.stringify({ client_request_id: 'intent-0001', title: 'same' })),
    job('q-2', JSON.stringify({ client_request_id: 'intent-0002', title: 'same' })),
  ]);
  assert(result.removed === 0 && result.jobs.length === 2, 'different request ids must remain separate intents');
}

// Exact persisted duplicate of one stable intent is safe to collapse.
{
  const body = JSON.stringify({ client_request_id: 'intent-replay-0001', title: 'same' });
  const result = dedupeJobsByIntent([job('q-1', body), job('q-2', body), job('q-3', body)]);
  assert(result.removed === 2, 'same stable intent and exact body should collapse to one record');
  assert(result.jobs.length === 1 && result.jobs[0].id === 'q-1', 'first canonical record/order must win');
}

// Same idempotency key but changed bytes is a conflict, not something client cleanup may hide.
{
  const result = dedupeJobsByIntent([
    job('q-1', JSON.stringify({ client_request_id: 'intent-conflict-0001', title: 'first' })),
    job('q-2', JSON.stringify({ client_request_id: 'intent-conflict-0001', title: 'changed' })),
  ]);
  assert(result.removed === 0 && result.jobs.length === 2, 'changed payload under same key must remain visible for server 409');
}

// Literal copied queue record can collapse, but same id with different bytes must fail safe.
{
  const body = '{not-json';
  const exact = job('same-queue-id', body);
  const result = dedupeJobsByIntent([
    exact,
    { ...exact },
    job('same-queue-id', '{different-invalid-json'),
  ]);
  assert(result.removed === 1, 'only exact duplicate queue record may collapse without business identity');
  assert(result.jobs.length === 2, 'same id with changed bytes must not be guessed away');
}

// Invalid/non-JSON bodies with different queue ids always survive.
{
  const result = dedupeJobsByIntent([job('q-1', 'not-json'), job('q-2', 'not-json')]);
  assert(result.removed === 0, 'invalid bodies must fail safe by preserving both records');
}

// User and endpoint are part of the client-intent identity boundary.
{
  const body = JSON.stringify({ client_request_id: 'intent-shared-text', value: 1 });
  const result = dedupeJobsByIntent([
    job('q-1', body),
    job('q-2', body, { userId: 'user-b' }),
    job('q-3', body, { path: '/api/v1/projects/other/messages' }),
    job('q-4', body, { method: 'PATCH' }),
  ]);
  assert(result.removed === 0 && result.jobs.length === 4, 'different user/method/path boundaries must never collapse');
}

console.log('offline intent dedupe contract OK');
