/** Offline sync runner — ручной запуск синхронизации outbox. */
import { API_BASE } from '@/lib/api/client';
import { offlineOutbox, type OfflineMutation } from './outbox';

export type OfflineSyncResult = {
  total: number;
  synced: number;
  failed: number;
  skipped: number;
};

export type OfflineOutboxStatus = {
  total: number;
  pending: number;
  blocked: number;
};

class OfflineReplayError extends Error {
  status: number;
  permanent: boolean;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'OfflineReplayError';
    this.status = status;
    this.permanent = status >= 400 && status < 500 && ![408, 425, 429].includes(status);
  }
}

let running = false;

async function replayMutation(item: OfflineMutation) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (item.userId) headers['X-User-Id'] = item.userId;

  const response = await fetch(`${API_BASE}${item.path}`, {
    method: item.method,
    headers,
    body: item.body === undefined ? undefined : JSON.stringify(item.body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new OfflineReplayError(response.status, text || `HTTP ${response.status}`);
  }
}

export async function flushOfflineOutbox(): Promise<OfflineSyncResult> {
  if (running) return { total: 0, synced: 0, failed: 0, skipped: 1 };

  running = true;
  const items = await offlineOutbox.list();
  const result: OfflineSyncResult = { total: items.length, synced: 0, failed: 0, skipped: 0 };

  try {
    for (const item of items) {
      if (item.blocked) {
        result.skipped += 1;
        continue;
      }

      try {
        await replayMutation(item);
        await offlineOutbox.remove(item.id);
        result.synced += 1;
      } catch (error) {
        const permanent = error instanceof OfflineReplayError && error.permanent;
        await offlineOutbox.markFailed(item.id, error, permanent);
        result.failed += 1;
      }
    }
    return result;
  } finally {
    running = false;
  }
}

export async function getOfflineOutboxStatus(): Promise<OfflineOutboxStatus> {
  const items = await offlineOutbox.list();
  const blocked = items.filter((item) => item.blocked).length;
  return {
    total: items.length,
    blocked,
    pending: items.length - blocked,
  };
}

export async function getOfflineOutboxSize() {
  const status = await getOfflineOutboxStatus();
  return status.pending;
}

export function isOfflineSyncRunning() {
  return running;
}
