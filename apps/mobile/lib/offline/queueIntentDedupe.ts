/**
 * Intent-aware offline queue dedupe (#386).
 *
 * Payload equality is not proof of duplication: a user can deliberately queue
 * two mutations with byte-identical method/path/body (e.g. two separate
 * expense lines of the same amount, two identical comments). Collapsing on
 * raw payload equality silently drops a real second user action.
 *
 * This module only removes queue records that are demonstrably the *same*
 * user intent:
 *  - an exact duplicate queue record (same `id`) — defensive; ids are
 *    generated unique, but a storage merge/migration could in theory
 *    duplicate one; or
 *  - same user + method + path + the same non-empty `client_request_id`
 *    extracted from the job body, which is the stable identity every
 *    create-style mutation now attaches via `createClientRequestId`.
 *
 * A job whose body is missing, not valid JSON, or has no non-empty
 * `client_request_id` never gets collapsed against another job on payload
 * content alone — it fails safe and both records survive. Queue order is
 * preserved.
 */

export type DedupeCandidateJob = {
  id: string;
  userId: string;
  method: string;
  path: string;
  body: string;
};

export type QueueIntentDedupeResult<T> = {
  jobs: T[];
  removed: number;
};

/**
 * Extracts a stable `client_request_id` from a queued job body.
 * Returns null (never throws) for empty, non-JSON, non-object, or
 * missing/empty-string ids — callers must treat null as "no proven intent
 * identity" and preserve the record rather than guess.
 */
export function extractClientRequestId(body: string): string | null {
  if (!body) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const raw = (parsed as Record<string, unknown>).client_request_id;
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

/**
 * Removes only demonstrably duplicate queue records. See module doc for the
 * exact collapse rules. Order of surviving jobs matches the input order.
 */
export function dedupeJobsByIntent<T extends DedupeCandidateJob>(
  jobs: T[],
): QueueIntentDedupeResult<T> {
  const seenIds = new Set<string>();
  const seenIntents = new Set<string>();
  const next: T[] = [];

  for (const job of jobs) {
    if (seenIds.has(job.id)) continue;
    seenIds.add(job.id);

    const requestId = extractClientRequestId(job.body);
    if (requestId) {
      const intentKey = JSON.stringify([job.userId, job.method, job.path, requestId]);
      if (seenIntents.has(intentKey)) continue;
      seenIntents.add(intentKey);
    }
    // No client_request_id: fail safe — never collapse on payload equality alone.

    next.push(job);
  }

  return { jobs: next, removed: jobs.length - next.length };
}
