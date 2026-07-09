/** Offline sync runner — ручной запуск синхронизации outbox. */
import { API_BASE } from '@/lib/api/client';
import { offlineOutbox, type OfflineMutation } from './outbox';

export type OfflineSyncResult = {
  total: number;
  synced: number;
  failed: number;
  skipped: number;
};

let running = false;

async function replayMutation(item: OfflineMutation) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (item.userId) headers['X-User-Id'] = item.userId;
  const res = await fetch(`${API_BASE}${item.path}`, {
    method: item.method,
    headers,
    body: item.body === undefined ? undefined : JSON.stringify(item.body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `HTTP ${res.status}`);
  }
}

export async function flushOfflineOutbox(): Promise<OfflineSyncResult> {
  if (running) return { total: 0, synced: 0, failed: 0, skipped: 1 };
  running = true;
  const items = await offlineOutbox.list();
  const result: OfflineSyncResult = { total: items.length, synced: 0, failed: 0, skipped: 0 };
  try {
    for (const item of items) {
      try {
        await replayMutation(item);
        await offlineOutbox.remove(item.id);
        result.synced += 1;
      } catch (error) {
        await offlineOutbox.markFailed(item.id, error);
        result.failed += 1;
      }
    }
    return result;
  } finally {
    running = false;
  }
}

export async function getOfflineOutboxSize() {
  const items = await offlineOutbox.list();
  return items.length;
}

export function isOfflineSyncRunning() {
  return running;
}
