/**
 * Offline outbox API — thin façade over canonical offlineQueue (A-01).
 * Не хранит отдельную очередь; legacy AsyncStorage ключи мигрируют в offlineQueue.
 */
import {
  OFFLINE_MAX_ATTEMPTS,
  OFFLINE_QUEUE_KEY,
  clearQueue,
  enqueueJob,
  getQueue,
  getQueueStatus,
  markJobFailed,
  removeJob,
  retryJob,
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
    let body = '';
    if (input.body !== undefined) {
      const serialized = JSON.stringify(input.body);
      if (serialized === undefined) throw new Error('offline_body_not_serializable');
      body = serialized;
    }
    const queued = await enqueueJob({
      path: input.path,
      method: input.method,
      userId: input.userId ?? '',
      body,
    });
    return jobToMutation(queued);
  },

  async remove(id: string) {
    await removeJob(id);
  },

  async markFailed(id: string, error: unknown, permanent = false) {
    const message = error instanceof Error ? error.message : String(error || 'sync_failed');
    const updated = await markJobFailed(id, message, permanent);
    if (!updated) throw new Error('offline_job_missing');
  },

  async retry(id: string) {
    await retryJob(id);
  },

  async clear() {
    await clearQueue();
  },

  async status() {
    return getQueueStatus();
  },
};

export { OFFLINE_QUEUE_KEY as OUTBOX_KEY, OFFLINE_MAX_ATTEMPTS as MAX_ATTEMPTS };
