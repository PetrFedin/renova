/**
 * Canonical offline engine (A-01).
 * Единственная очередь: AsyncStorage key `renova_offline_queue`.
 * Все API enqueue и layout flush идут сюда; UI читает тот же статус.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { decideFlushOutcome, parseRetryAfterMs } from '@/lib/offline/flushPolicy';
import {
  mergeQueueFlushMutations,
  type QueueFlushMutation,
} from '@/lib/offline/queueMerge';
import { filterJobsExceptProject } from '@/lib/offline/projectQueueFilter';
import {
  OfflineQueueStorageError,
  parseOfflineQueueStorage,
} from '@/lib/offlineQueueStorage';
import { authHeaders } from '@/lib/api/client';
import { reportError } from '@/lib/reportError';

const KEY = 'renova_offline_queue';
/** Legacy keys from parallel outbox stacks — migrate once into KEY. */
const LEGACY_KEYS = ['renova_offline_outbox:v1', 'renova_offline_outbox_v1'] as const;
const MAX_ATTEMPTS = 5;
const REQUEST_TIMEOUT_MS = 15_000;

export type OfflineJob = {
  path: string;
  method: string;
  body: string;
  userId: string;
  ts: number;
  id: string;
  attempts?: number;
  blocked?: boolean;
  /** 409 Conflict — остаётся в очереди до ручного разбора. */
  conflict?: boolean;
  lastError?: string;
  /** Не отправлять раньше этого времени после временной ошибки. */
  nextAttemptAt?: number;
  lastAttemptAt?: number;
  /** Защита от overwrite, если задание изменили во время network flush. */
  version?: number;
};

export type OfflineFlushResult = {
  synced: number;
  conflicts: number;
  failed: number;
  pending: number;
  blocked: number;
  deferred: number;
};

export type OfflineQueueStatus = {
  total: number;
  pending: number;
  ready: number;
  deferred: number;
  blocked: number;
  conflicts: number;
};

let queueMutationChain: Promise<void> = Promise.resolve();
let activeFlush: Promise<OfflineFlushResult> | null = null;

function withQueueLock<T>(operation: () => Promise<T>): Promise<T> {
  const run = queueMutationChain.then(operation, operation);
  queueMutationChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function normalizeJob(raw: Record<string, unknown>): OfflineJob | null {
  const path = typeof raw.path === 'string' ? raw.path : '';
  const method = typeof raw.method === 'string' ? raw.method : 'POST';
  if (!path) return null;

  let body = '';
  if (typeof raw.body === 'string') body = raw.body;
  else if (raw.body !== undefined) {
    body = JSON.stringify(raw.body);
  }

  const userId =
    typeof raw.userId === 'string'
      ? raw.userId
      : typeof raw.user_id === 'string'
        ? raw.user_id
        : '';

  const id =
    typeof raw.id === 'string'
      ? raw.id
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const ts =
    typeof raw.ts === 'number'
      ? raw.ts
      : typeof raw.createdAt === 'string'
        ? Date.parse(raw.createdAt) || Date.now()
        : typeof raw.created_at === 'string'
          ? Date.parse(raw.created_at) || Date.now()
          : Date.now();

  return {
    path,
    method,
    body,
    userId,
    ts,
    id,
    attempts: typeof raw.attempts === 'number' ? raw.attempts : typeof raw.retries === 'number' ? raw.retries : 0,
    blocked: Boolean(raw.blocked),
    conflict: Boolean(raw.conflict),
    lastError: typeof raw.lastError === 'string' ? raw.lastError : typeof raw.last_error === 'string' ? raw.last_error : undefined,
    nextAttemptAt: typeof raw.nextAttemptAt === 'number' ? raw.nextAttemptAt : undefined,
    lastAttemptAt: typeof raw.lastAttemptAt === 'number' ? raw.lastAttemptAt : undefined,
    version: typeof raw.version === 'number' ? raw.version : 0,
  };
}

async function readRaw(key: string): Promise<unknown[]> {
  const raw = await AsyncStorage.getItem(key);
  return parseOfflineQueueStorage(raw, key);
}

function normalizeStoredJobs(raw: unknown[], storageKey: string): OfflineJob[] {
  return raw.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new OfflineQueueStorageError(storageKey, 'invalid_job', index);
    }
    const job = normalizeJob(item as Record<string, unknown>);
    if (!job) throw new OfflineQueueStorageError(storageKey, 'invalid_job', index);
    return job;
  });
}

async function migrateLegacyQueues(existing: OfflineJob[]): Promise<OfflineJob[]> {
  const byId = new Map(existing.map((job) => [job.id, job]));
  const cleanupKeys: string[] = [];
  let changed = false;

  for (const key of LEGACY_KEYS) {
    const legacyRaw = await readRaw(key);
    if (!legacyRaw.length) continue;
    const legacy = normalizeStoredJobs(legacyRaw, key);
    for (const job of legacy) {
      if (byId.has(job.id)) continue;
      byId.set(job.id, job);
      changed = true;
    }
    cleanupKeys.push(key);
  }

  const merged = changed
    ? [...byId.values()].sort((a, b) => a.ts - b.ts)
    : existing;

  // Persist the canonical copy before deleting any legacy storage. If this write
  // fails, all source keys remain untouched and the caller sees a real error.
  if (changed) {
    await AsyncStorage.setItem(KEY, JSON.stringify(merged));
  }

  for (const key of cleanupKeys) {
    try {
      await AsyncStorage.removeItem(key);
    } catch (error) {
      // Canonical data is already durable; failed cleanup is observable but must
      // not make a healthy queue unavailable or risk deleting user mutations.
      reportError('offline.legacyQueue.cleanup', error, { storageKey: key });
    }
  }

  return merged;
}

async function getQueueUnlocked(): Promise<OfflineJob[]> {
  const raw = await readRaw(KEY);
  const jobs = normalizeStoredJobs(raw, KEY);
  return migrateLegacyQueues(jobs);
}

async function setQueueUnlocked(jobs: OfflineJob[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(jobs));
}

function queueStatusFromJobs(jobs: OfflineJob[], now = Date.now()): OfflineQueueStatus {
  const blocked = jobs.filter((job) => job.blocked).length;
  const conflicts = jobs.filter((job) => job.conflict && !job.blocked).length;
  const active = jobs.filter((job) => !job.blocked && !job.conflict);
  const deferred = active.filter((job) => (job.nextAttemptAt ?? 0) > now).length;
  return {
    total: jobs.length,
    blocked,
    conflicts,
    pending: active.length,
    ready: active.length - deferred,
    deferred,
  };
}

export function getQueue(): Promise<OfflineJob[]> {
  return withQueueLock(getQueueUnlocked);
}

export async function queueStats() {
  const status = await getQueueStatus();
  return { pending: status.pending };
}

export async function getQueueStatus(): Promise<OfflineQueueStatus> {
  return queueStatusFromJobs(await getQueue());
}

async function emitQueueChanged(): Promise<void> {
  // W93: баннер/статус очереди без focus (dynamic import — без цикла offline↔queue)
  try {
    const { notifyOfflineFlush } = await import('@/lib/offline/flushBus');
    notifyOfflineFlush();
  } catch {
    /* test env */
  }
}

export async function enqueue(job: Omit<OfflineJob, 'ts' | 'id' | 'attempts' | 'blocked' | 'conflict' | 'lastError' | 'nextAttemptAt' | 'lastAttemptAt' | 'version'>) {
  const length = await withQueueLock(async () => {
    const queue = await getQueueUnlocked();
    queue.push({
      ...job,
      ts: Date.now(),
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      attempts: 0,
      blocked: false,
      conflict: false,
      version: 0,
    });
    await setQueueUnlocked(queue);
    return queue.length;
  });
  await emitQueueChanged();
  return length;
}

export async function removeJob(id: string) {
  const length = await withQueueLock(async () => {
    const queue = (await getQueueUnlocked()).filter((job) => job.id !== id);
    await setQueueUnlocked(queue);
    return queue.length;
  });
  await emitQueueChanged();
  return length;
}

export async function retryJob(id: string) {
  await withQueueLock(async () => {
    const queue = await getQueueUnlocked();
    await setQueueUnlocked(
      queue.map((job) =>
        job.id === id
          ? {
              ...job,
              attempts: 0,
              blocked: false,
              conflict: false,
              lastError: undefined,
              nextAttemptAt: undefined,
              lastAttemptAt: undefined,
              version: (job.version ?? 0) + 1,
            }
          : job,
      ),
    );
  });
  await emitQueueChanged();
}

/**
 * Update only one conflict body against the latest queue snapshot.
 * This prevents a stale screen snapshot from overwriting jobs enqueued in parallel.
 */
export async function updateJobBody(id: string, body: string): Promise<boolean> {
  const updated = await withQueueLock(async () => {
    const queue = await getQueueUnlocked();
    let found = false;
    const next = queue.map((job) => {
      if (job.id !== id) return job;
      found = true;
      return {
        ...job,
        body,
        version: (job.version ?? 0) + 1,
      };
    });
    if (found) await setQueueUnlocked(next);
    return found;
  });
  if (updated) await emitQueueChanged();
  return updated;
}

/** Remove only exact duplicate mutations from the latest locked queue. */
export async function dedupeExactJobs(): Promise<number> {
  const removed = await withQueueLock(async () => {
    const queue = await getQueueUnlocked();
    const seen = new Set<string>();
    const next = queue.filter((job) => {
      const signature = JSON.stringify([job.userId, job.method, job.path, job.body]);
      if (seen.has(signature)) return false;
      seen.add(signature);
      return true;
    });
    const count = queue.length - next.length;
    if (count > 0) await setQueueUnlocked(next);
    return count;
  });
  if (removed > 0) await emitQueueChanged();
  return removed;
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function flushOnce(apiBase: string): Promise<OfflineFlushResult> {
  const snapshot = await getQueue();
  if (!snapshot.length) {
    return { synced: 0, conflicts: 0, failed: 0, pending: 0, blocked: 0, deferred: 0 };
  }

  const sorted = [...snapshot].sort((a, b) => a.ts - b.ts);
  const mutations: QueueFlushMutation<OfflineJob>[] = [];
  let synced = 0;
  let conflicts = 0;
  let failed = 0;
  let deferred = 0;

  for (const job of sorted) {
    if (job.blocked || job.conflict) continue;
    const now = Date.now();
    if ((job.nextAttemptAt ?? 0) > now) {
      deferred += 1;
      continue;
    }

    const expectedVersion = job.version ?? 0;
    try {
      const response = await fetchWithTimeout(`${apiBase}${job.path}`, {
        method: job.method,
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(job.userId),
          'X-Offline-Id': job.id,
        },
        body: job.body,
      });

      const errorText = response.ok ? '' : await response.text().catch(() => '');
      const message = errorText || (response.ok ? 'ok' : `HTTP ${response.status}`);
      const attemptedAt = Date.now();
      const retryAfterMs = parseRetryAfterMs(response.headers.get('Retry-After'), attemptedAt);
      const decision = decideFlushOutcome(
        response.status,
        message,
        job.attempts ?? 0,
        attemptedAt,
        retryAfterMs,
      );

      if (decision.action === 'drop') {
        synced += 1;
        mutations.push({ id: job.id, expectedVersion, next: null });
        continue;
      }
      if (decision.action === 'conflict') {
        conflicts += 1;
        mutations.push({
          id: job.id,
          expectedVersion,
          next: {
            ...job,
            conflict: true,
            blocked: false,
            nextAttemptAt: undefined,
            lastAttemptAt: attemptedAt,
            lastError: decision.message,
          },
        });
        continue;
      }
      if (decision.action === 'block') {
        failed += 1;
        mutations.push({
          id: job.id,
          expectedVersion,
          next: {
            ...job,
            attempts: decision.attempts,
            blocked: true,
            conflict: false,
            nextAttemptAt: undefined,
            lastAttemptAt: attemptedAt,
            lastError: decision.message,
          },
        });
        continue;
      }

      failed += 1;
      mutations.push({
        id: job.id,
        expectedVersion,
        next: {
          ...job,
          attempts: decision.attempts,
          blocked: decision.blocked,
          conflict: false,
          nextAttemptAt: decision.nextAttemptAt,
          lastAttemptAt: attemptedAt,
          lastError: decision.message,
        },
      });
    } catch (error) {
      failed += 1;
      const attemptedAt = Date.now();
      const message = error instanceof Error
        ? error.name === 'AbortError'
          ? 'request_timeout'
          : error.message
        : 'network_error';
      const decision = decideFlushOutcome(
        null,
        message,
        job.attempts ?? 0,
        attemptedAt,
      );
      mutations.push({
        id: job.id,
        expectedVersion,
        next: {
          ...job,
          attempts: decision.action === 'retry' ? decision.attempts : (job.attempts ?? 0) + 1,
          blocked: decision.action === 'retry' ? decision.blocked : true,
          conflict: false,
          nextAttemptAt: decision.action === 'retry' ? decision.nextAttemptAt : undefined,
          lastAttemptAt: attemptedAt,
          lastError: decision.action === 'retry' ? decision.message : message,
        },
      });
    }
  }

  let finalQueue = snapshot;
  if (mutations.length > 0) {
    finalQueue = await withQueueLock(async () => {
      const current = await getQueueUnlocked();
      const merged = mergeQueueFlushMutations(current, mutations);
      await setQueueUnlocked(merged);
      return merged;
    });
    await emitQueueChanged();
  }

  const status = queueStatusFromJobs(finalQueue);
  return {
    synced,
    conflicts,
    failed,
    pending: status.pending,
    blocked: status.blocked,
    deferred: Math.max(deferred, status.deferred),
  };
}

/**
 * Replay queue against API.
 * - 2xx → remove
 * - 409 → conflict, manual retry only
 * - permanent 4xx → block (no auto retry)
 * - 5xx / network / temp 4xx → exponential backoff, block after MAX_ATTEMPTS
 */
export function flush(apiBase: string): Promise<OfflineFlushResult> {
  if (activeFlush) return activeFlush;
  activeFlush = flushOnce(apiBase).finally(() => {
    activeFlush = null;
  });
  return activeFlush;
}

/** После archive/trash/purge — не replay мутации по этому project_id. */
export async function dropJobsForProject(projectId: string): Promise<number> {
  const dropped = await withQueueLock(async () => {
    const queue = await getQueueUnlocked();
    const next = filterJobsExceptProject(queue, projectId);
    const count = queue.length - next.length;
    if (count > 0) await setQueueUnlocked(next);
    return count;
  });
  if (dropped > 0) await emitQueueChanged();
  return dropped;
}

export const OFFLINE_QUEUE_KEY = KEY;
export const OFFLINE_MAX_ATTEMPTS = MAX_ATTEMPTS;
export const OFFLINE_REQUEST_TIMEOUT_MS = REQUEST_TIMEOUT_MS;
