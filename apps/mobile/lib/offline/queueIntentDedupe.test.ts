/**
 * #386: intent-aware offline queue dedupe must never collapse two distinct
 * user intents merely because method/path/body are byte-equal, and must
 * collapse only a proven-duplicate record (same id, or same
 * user+method+path+client_request_id).
 */
import { dedupeJobsByIntent, extractClientRequestId, type DedupeCandidateJob } from './queueIntentDedupe';

function must(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function job(overrides: Partial<DedupeCandidateJob> & { id: string }): DedupeCandidateJob {
  return {
    id: overrides.id,
    userId: overrides.userId ?? 'user-1',
    method: overrides.method ?? 'POST',
    path: overrides.path ?? '/api/v1/projects/p1/os/expenses',
    body: overrides.body ?? '{}',
  };
}

// (a) Two records that are genuinely the same attempt — same client_request_id,
// same user/method/path — collapse to one, keeping the first.
{
  const requestId = 'expense-abc123';
  const jobs = [
    job({ id: 'q1', body: JSON.stringify({ amount: 500, client_request_id: requestId }) }),
    job({ id: 'q2', body: JSON.stringify({ amount: 500, client_request_id: requestId }) }),
  ];
  const result = dedupeJobsByIntent(jobs);
  must(result.jobs.length === 1, 'same client_request_id must collapse to a single job');
  must(result.jobs[0].id === 'q1', 'the earlier record of a duplicate intent survives');
  must(result.removed === 1, 'reports exactly one removed duplicate');
}

// (b) Two DIFFERENT intents that happen to carry identical payload (same
// amount, same everything) except for client_request_id must NOT collapse —
// this is the exact data-loss bug #386 reports.
{
  const jobs = [
    job({ id: 'q1', body: JSON.stringify({ amount: 500, client_request_id: 'expense-aaa' }) }),
    job({ id: 'q2', body: JSON.stringify({ amount: 500, client_request_id: 'expense-bbb' }) }),
  ];
  const result = dedupeJobsByIntent(jobs);
  must(result.jobs.length === 2, 'different client_request_id with identical payload must survive both');
  must(result.removed === 0, 'no job is reported removed when intents differ');
}

// Same byte-equal payload with NO client_request_id at all must fail safe and
// preserve both records — payload equality alone never proves duplication.
{
  const jobs = [
    job({ id: 'q1', body: JSON.stringify({ note: 'same note, no id' }) }),
    job({ id: 'q2', body: JSON.stringify({ note: 'same note, no id' }) }),
  ];
  const result = dedupeJobsByIntent(jobs);
  must(result.jobs.length === 2, 'byte-equal payload without client_request_id must survive');
}

// Different users must never collapse into each other, even with the same
// client_request_id and payload (queue is shared across accounts on device).
{
  const requestId = 'shared-id';
  const jobs = [
    job({ id: 'q1', userId: 'user-1', body: JSON.stringify({ client_request_id: requestId }) }),
    job({ id: 'q2', userId: 'user-2', body: JSON.stringify({ client_request_id: requestId }) }),
  ];
  const result = dedupeJobsByIntent(jobs);
  must(result.jobs.length === 2, 'different users with the same client_request_id must not collapse');
}

// Invalid/non-JSON bodies fail safe: preserve both records rather than guess.
{
  const jobs = [
    job({ id: 'q1', body: 'not-json' }),
    job({ id: 'q2', body: 'not-json' }),
  ];
  const result = dedupeJobsByIntent(jobs);
  must(result.jobs.length === 2, 'non-JSON bodies must never be collapsed');
  must(extractClientRequestId('not-json') === null, 'non-JSON body yields no client_request_id');
  must(extractClientRequestId('[]') === null, 'array body yields no client_request_id');
  must(extractClientRequestId(JSON.stringify({ client_request_id: '' })) === null, 'empty client_request_id is treated as absent');
  must(extractClientRequestId(JSON.stringify({ client_request_id: 'abc' })) === 'abc', 'valid client_request_id is extracted');
}

// An exact duplicate queue record (same id) is defensively collapsed too —
// this can only arise from a storage merge bug, never from normal enqueue.
{
  const jobs = [
    job({ id: 'dup', body: '{}' }),
    job({ id: 'dup', body: '{}' }),
  ];
  const result = dedupeJobsByIntent(jobs);
  must(result.jobs.length === 1, 'exact duplicate queue id collapses to one record');
}

// Order of surviving jobs is preserved.
{
  const jobs = [
    job({ id: 'q1', path: '/a' }),
    job({ id: 'q2', path: '/b' }),
    job({ id: 'q3', path: '/c' }),
  ];
  const result = dedupeJobsByIntent(jobs);
  must(
    result.jobs.map((j) => j.id).join(',') === 'q1,q2,q3',
    'queue order is preserved when nothing collapses',
  );
}

console.log('queueIntentDedupe.test OK');
