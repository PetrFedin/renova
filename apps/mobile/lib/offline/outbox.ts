/**
 * Offline outbox API — thin façade over canonical offlineQueue (A-01).
 * Не хранит отдельную очередь; legacy AsyncStorage ключи мигрируют в offlineQueue.
 */
import {
  OFFLINE_MAX_ATTEMPTS,
  OFFLINE_QUEUE_KEY,
  enqueue,
  getQueue,
  getQueueStatus,
  removeJob,
  retryJob,
  writeQueue,
  type OfflineJob,
} from '@/lib/offlineQueue';

export type OfflineMutationMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type OfflineMutation = {
  id: string;
  path: string;
  method: OfflineMutationMethod;
  userId?: string;
  body?: unknown;
  createdAt: string;
  attempts: number;
  lastError?: string;
  blocked?: boolean;
};

function jobToMutation(job: OfflineJob): OfflineMutation {
  let body: unknown;
  try {
    body = job.body ? JSON.parse(job.body) : undefined;
  } catch {
    body = job.body;
  }
  return {
    id: job.id,
    path: job.path,
    method: (job.method.toUpperCase() as OfflineMutationMethod) || 'POST',
    userId: job.userId || undefined,
    body,
    createdAt: new Date(job.ts).toISOString(),
    attempts: job.attempts ?? 0,
    lastError: job.lastError,
    blocked: job.blocked,
  };
}

export const offlineOutbox = {
  async list() {
    return (await getQueue()).map(jobToMutation);
  },

  async enqueue(input: {
    path: string;
    method: OfflineMutationMethod;
    userId?: string;
    body?: unknown;
  }) {
    await enqueue({
      path: input.path,
      method: input.method,
      userId: input.userId ?? '',
      body: input.body === undefined ? '' : JSON.stringify(input.body),
    });
    const items = await this.list();
    return items[items.length - 1];
  },

  async remove(id: string) {
    await removeJob(id);
  },

  async markFailed(id: string, error: unknown, permanent = false) {
    const q = await getQueue();
    const message = error instanceof Error ? error.message : String(error || 'sync_failed');
    await writeQueue(
      q.map((item) => {
        if (item.id !== id) return item;
        const attempts = (item.attempts ?? 0) + 1;
        return {
          ...item,
          attempts,
          lastError: message,
          blocked: permanent || attempts >= OFFLINE_MAX_ATTEMPTS,
        };
      }),
    );
  },

  async retry(id: string) {
    await retryJob(id);
  },

  async clear() {
    await writeQueue([]);
  },

  async status() {
    return getQueueStatus();
  },
};

export { OFFLINE_QUEUE_KEY as OUTBOX_KEY, OFFLINE_MAX_ATTEMPTS as MAX_ATTEMPTS };
