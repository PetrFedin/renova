/**
 * Canonical offline engine (A-01).
 * Единственная очередь: AsyncStorage key `renova_offline_queue`.
 * Все API enqueue и layout flush идут сюда; UI читает тот же статус.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { decideFlushOutcome } from '@/lib/offline/flushPolicy';
import { filterJobsExceptProject } from '@/lib/offline/projectQueueFilter';
import { authHeaders } from '@/lib/api/client';

const KEY = 'renova_offline_queue';
/** Legacy keys from parallel outbox stacks — migrate once into KEY. */
const LEGACY_KEYS = ['renova_offline_outbox:v1', 'renova_offline_outbox_v1'] as const;
const MAX_ATTEMPTS = 5;

export type OfflineJob = {
  path: string;
  method: string;
  body: string;
  userId: string;
  ts: number;
  id: string;
  attempts?: number;
  blocked?: boolean;
  /** 409 Conflict — остаётся в очереди до ручного разбора */
  conflict?: boolean;
  lastError?: string;
};

export type OfflineFlushResult = {
  synced: number;
  conflicts: number;
  failed: number;
  pending: number;
  blocked: number;
};

export type OfflineQueueStatus = {
  total: number;
  pending: number;
  blocked: number;
  conflicts: number;
};

function normalizeJob(raw: Record<string, unknown>): OfflineJob | null {
  const path = typeof raw.path === 'string' ? raw.path : '';
  const method = typeof raw.method === 'string' ? raw.method : 'POST';
  if (!path) return null;

  let body = '';
  if (typeof raw.body === 'string') body = raw.body;
  else if (raw.body !== undefined) {
    try {
      body = JSON.stringify(raw.body);
    } catch {
      body = '';
    }
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
  };
}

async function readRaw(key: string): Promise<unknown[]> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function migrateLegacyQueues(existing: OfflineJob[]): Promise<OfflineJob[]> {
  const byId = new Map(existing.map((j) => [j.id, j]));
  let changed = false;

  for (const key of LEGACY_KEYS) {
    const legacy = await readRaw(key);
    if (!legacy.length) continue;
    for (const item of legacy) {
      if (!item || typeof item !== 'object') continue;
      const job = normalizeJob(item as Record<string, unknown>);
      if (!job || byId.has(job.id)) continue;
      byId.set(job.id, job);
      changed = true;
    }
    await AsyncStorage.removeItem(key);
  }

  if (!changed) return existing;
  const merged = [...byId.values()].sort((a, b) => a.ts - b.ts);
  await AsyncStorage.setItem(KEY, JSON.stringify(merged));
  return merged;
}

export async function getQueue(): Promise<OfflineJob[]> {
  const raw = await readRaw(KEY);
  const jobs = raw
    .map((item) => (item && typeof item === 'object' ? normalizeJob(item as Record<string, unknown>) : null))
    .filter((j): j is OfflineJob => Boolean(j));
  return migrateLegacyQueues(jobs);
}

export async function queueStats() {
  const status = await getQueueStatus();
  return { pending: status.pending };
}

export async function getQueueStatus(): Promise<OfflineQueueStatus> {
  const q = await getQueue();
  const blocked = q.filter((j) => j.blocked).length;
  const conflicts = q.filter((j) => j.conflict && !j.blocked).length;
  return {
    total: q.length,
    blocked,
    conflicts,
    pending: q.length - blocked,
  };
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

export async function enqueue(job: Omit<OfflineJob, 'ts' | 'id' | 'attempts' | 'blocked' | 'conflict' | 'lastError'>) {
  const q = await getQueue();
  q.push({
    ...job,
    ts: Date.now(),
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    attempts: 0,
    blocked: false,
    conflict: false,
  });
  await AsyncStorage.setItem(KEY, JSON.stringify(q));
  await emitQueueChanged();
  return q.length;
}

export async function removeJob(id: string) {
  const q = (await getQueue()).filter((j) => j.id !== id);
  await AsyncStorage.setItem(KEY, JSON.stringify(q));
  await emitQueueChanged();
  return q.length;
}

export async function retryJob(id: string) {
  const q = await getQueue();
  await AsyncStorage.setItem(
    KEY,
    JSON.stringify(
      q.map((j) =>
        j.id === id
          ? { ...j, attempts: 0, blocked: false, conflict: false, lastError: undefined }
          : j,
      ),
    ),
  );
  await emitQueueChanged();
}


/**
 * Replay queue against API.
 * - 2xx → remove
 * - 409 → keep as conflict (manual)
 * - permanent 4xx → block (no auto retry)
 * - 5xx / network / temp 4xx → attempts++, block after MAX_ATTEMPTS
 */
export async function flush(apiBase: string): Promise<OfflineFlushResult> {
  const q = await getQueue();
  if (!q.length) {
    return { synced: 0, conflicts: 0, failed: 0, pending: 0, blocked: 0 };
  }

  const sorted = [...q].sort((a, b) => a.ts - b.ts);
  const left: OfflineJob[] = [];
  let synced = 0;
  let conflicts = 0;
  let failed = 0;

  for (const j of sorted) {
    if (j.blocked) {
      left.push(j);
      continue;
    }

    try {
      const r = await fetch(`${apiBase}${j.path}`, {
        method: j.method,
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(j.userId),
          'X-Offline-Id': j.id,
        },
        body: j.body,
      });

      const errText = r.ok ? '' : await r.text().catch(() => '');
      const message = errText || (r.ok ? 'ok' : `HTTP ${r.status}`);
      const decision = decideFlushOutcome(r.status, message, j.attempts ?? 0);

      if (decision.action === 'drop') {
        synced += 1;
        continue;
      }
      if (decision.action === 'conflict') {
        conflicts += 1;
        left.push({ ...j, conflict: true, lastError: decision.message });
        continue;
      }
      if (decision.action === 'block') {
        failed += 1;
        left.push({
          ...j,
          attempts: (j.attempts ?? 0) + 1,
          blocked: true,
          lastError: decision.message,
        });
        continue;
      }
      failed += 1;
      left.push({
        ...j,
        attempts: decision.attempts,
        blocked: decision.blocked,
        conflict: false,
        lastError: decision.message,
      });
    } catch (e) {
      failed += 1;
      const decision = decideFlushOutcome(
        null,
        e instanceof Error ? e.message : 'network_error',
        j.attempts ?? 0,
      );
      left.push({
        ...j,
        attempts: decision.action === 'retry' ? decision.attempts : (j.attempts ?? 0) + 1,
        blocked: decision.action === 'retry' ? decision.blocked : true,
        lastError: decision.action === 'retry' ? decision.message : 'network_error',
      });
    }
  }

  await AsyncStorage.setItem(KEY, JSON.stringify(left));
  const blocked = left.filter((j) => j.blocked).length;
  return {
    synced,
    conflicts,
    failed,
    pending: left.length - blocked,
    blocked,
  };
}


export async function writeQueue(jobs: OfflineJob[]) {
  await AsyncStorage.setItem(KEY, JSON.stringify(jobs));
  await emitQueueChanged();
}

/** После archive/trash/purge — не replay мутации по этому project_id. */
export async function dropJobsForProject(projectId: string): Promise<number> {
  const q = await getQueue();
  const next = filterJobsExceptProject(q, projectId);
  const dropped = q.length - next.length;
  if (dropped > 0) {
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
    await emitQueueChanged();
  }
  return dropped;
}

export const OFFLINE_QUEUE_KEY = KEY;
export const OFFLINE_MAX_ATTEMPTS = MAX_ATTEMPTS;
