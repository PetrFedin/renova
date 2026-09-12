export type IntentDedupeJob = {
  id: string;
  userId: string;
  method: string;
  path: string;
  body: string;
};

export type IntentDedupeResult<T> = {
  jobs: T[];
  removed: number;
};

function clientRequestId(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const value = (parsed as Record<string, unknown>).client_request_id;
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
  } catch {
    // Invalid/non-JSON payload has no provable business identity. Preserve it.
    return null;
  }
}

function duplicateSignature(job: IntentDedupeJob): string | null {
  // A copied queue record is demonstrably the same record only when both the
  // generated queue id and its exact persisted mutation bytes match.
  const queueRecord = JSON.stringify([
    'queue-record',
    job.id,
    job.userId,
    job.method,
    job.path,
    job.body,
  ]);

  const requestId = clientRequestId(job.body);
  if (!requestId) return queueRecord;

  // A business request id proves one user intent, but changed bytes under the
  // same key are intentionally NOT collapsed: the server must be allowed to
  // surface the canonical idempotency conflict instead of the queue hiding it.
  return JSON.stringify([
    'client-intent',
    job.userId,
    job.method,
    job.path,
    requestId,
    job.body,
  ]);
}

/**
 * Remove only demonstrably repeated records/intents while preserving order.
 *
 * Payload equality alone is never identity. Two byte-identical jobs without a
 * stable client_request_id remain two jobs because they can be two real taps.
 */
export function dedupeJobsByIntent<T extends IntentDedupeJob>(input: T[]): IntentDedupeResult<T> {
  const seen = new Set<string>();
  const jobs: T[] = [];

  for (const job of input) {
    const signature = duplicateSignature(job);
    if (signature && seen.has(signature)) continue;
    if (signature) seen.add(signature);
    jobs.push(job);
  }

  return { jobs, removed: input.length - jobs.length };
}
