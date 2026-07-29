import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const src = (relativePath: string) => readFileSync(join(root, relativePath), 'utf8');
const must = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

const queue = src('lib/offlineQueue.ts');
const policy = src('lib/offline/flushPolicy.ts');
const merge = src('lib/offline/queueMerge.ts');
const recovery = src('app/_stack/conflicts.tsx');

must(queue.includes('REQUEST_TIMEOUT_MS = 15_000'), 'offline fetch has bounded timeout');
must(queue.includes('if (job.blocked || job.conflict) continue'), 'blocked and conflict jobs are not auto-replayed');
must(queue.includes('(job.nextAttemptAt ?? 0) > now'), 'deferred retry window is respected');
must(queue.includes('activeFlush') && queue.includes('if (activeFlush) return activeFlush'), 'parallel flush calls coalesce');
must(queue.includes('withQueueLock') && queue.includes('mergeQueueFlushMutations'), 'storage mutations and late network results are race-safe');
must(queue.includes('version: (job.version ?? 0) + 1'), 'manual retry invalidates stale network result');
must(policy.includes('RETRY_BASE_MS = 5_000') && policy.includes('RETRY_MAX_MS = 5 * 60_000'), 'retry backoff is bounded');
must(policy.includes('parseRetryAfterMs'), 'server Retry-After is honored');
must(merge.includes('currentVersion !== mutation.expectedVersion'), 'flush merge is version guarded');
must(recovery.includes('Повторить сейчас') && recovery.includes('retryJob(jobId)'), 'manual per-job retry is available');
must(recovery.includes('primaryDestructive: true') && recovery.includes('dangerOutline'), 'manual deletion is explicitly destructive');
must(recovery.includes('await writeQueue(next);') && recovery.includes('await retryNow(job.id);'), 'manual merge clears conflict and retries');

console.log('offlineOutboxReliabilityContract.test OK');
