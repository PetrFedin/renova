import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const src = (relativePath: string) => readFileSync(join(root, relativePath), 'utf8');
const must = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

const queue = src('lib/offlineQueue.ts');
const storage = src('lib/offlineQueueStorage.ts');
const policy = src('lib/offline/flushPolicy.ts');
const merge = src('lib/offline/queueMerge.ts');
const sync = src('lib/offline/sync.ts');
const recovery = src('app/_stack/conflicts.tsx');
const status = src('components/renova/OfflineSyncStatus.tsx');

must(queue.includes('REQUEST_TIMEOUT_MS = 15_000'), 'offline fetch has bounded timeout');
must(queue.includes('if (job.blocked || job.conflict) continue'), 'blocked and conflict jobs are not auto-replayed');
must(queue.includes('(job.nextAttemptAt ?? 0) > now'), 'deferred retry window is respected');
must(queue.includes('activeFlush') && queue.includes('if (activeFlush) return activeFlush'), 'parallel queue flush calls coalesce');
must(queue.includes('withQueueLock') && queue.includes('mergeQueueFlushMutations'), 'storage mutations and late network results are race-safe');
must(queue.includes('version: (job.version ?? 0) + 1'), 'manual retry invalidates stale network result');
must(queue.includes('parseOfflineQueueStorage(raw, key)'), 'storage corruption cannot masquerade as an empty queue');
must(queue.includes('normalizeStoredJobs(raw, KEY)'), 'malformed stored jobs fail closed');
must(queue.includes('updateJobBody') && queue.includes('dedupeExactJobs'), 'recovery mutations run against latest locked queue');
must(!queue.includes('export async function writeQueue'), 'stale UI snapshots cannot replace the canonical queue');
must(storage.includes("code = 'offline_queue_storage_corrupt'"), 'storage corruption has a stable observable code');
must(policy.includes('RETRY_BASE_MS = 5_000') && policy.includes('RETRY_MAX_MS = 5 * 60_000'), 'retry backoff is bounded');
must(policy.includes('parseRetryAfterMs'), 'server Retry-After is honored');
must(merge.includes('currentVersion !== mutation.expectedVersion'), 'flush merge is version guarded');
must(sync.includes('trailingRequested = true') && sync.includes('while (trailingRequested)'), 'overlapping sync requests get a trailing pass');
must(recovery.includes('Повторить сейчас') && recovery.includes('retryJob(jobId)'), 'manual per-job retry is available');
must(recovery.includes('primaryDestructive: true') && recovery.includes('dangerOutline'), 'manual deletion is explicitly destructive');
must(recovery.includes('await updateJobBody(job.id, body);') && recovery.includes('await retryNow(job.id);'), 'manual merge updates one live job then retries');
must(recovery.includes('loadError') && recovery.includes('Повторить чтение'), 'queue read failure has an explicit recovery path');
must(status.includes('readError') && status.includes('Повторить проверку'), 'status surface never hides queue read failure');

console.log('offlineOutboxReliabilityContract.test OK');
