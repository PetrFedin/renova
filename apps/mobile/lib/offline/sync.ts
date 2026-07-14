/**
 * Offline sync runner — flush canonical offlineQueue (A-01).
 * OfflineSyncStatus и ручная синхронизация используют только этот путь.
 */
import { API_BASE } from '@/lib/api/client';
import {
  flush,
  getQueueStatus,
  type OfflineFlushResult,
  type OfflineQueueStatus,
} from '@/lib/offlineQueue';

export type OfflineSyncResult = {
  total: number;
  synced: number;
  failed: number;
  skipped: number;
  conflicts: number;
};

export type OfflineOutboxStatus = OfflineQueueStatus;

let running = false;

export async function flushOfflineOutbox(apiBase: string = API_BASE): Promise<OfflineSyncResult> {
  if (running) {
    return { total: 0, synced: 0, failed: 0, skipped: 1, conflicts: 0 };
  }

  running = true;
  try {
    const before = await getQueueStatus();
    const result: OfflineFlushResult = await flush(apiBase);
    return {
      total: before.total,
      synced: result.synced,
      failed: result.failed,
      skipped: result.blocked,
      conflicts: result.conflicts,
    };
  } finally {
    running = false;
  }
}

export async function getOfflineOutboxStatus(): Promise<OfflineOutboxStatus> {
  return getQueueStatus();
}

export async function getOfflineOutboxSize() {
  const status = await getOfflineOutboxStatus();
  return status.pending;
}

export function isOfflineSyncRunning() {
  return running;
}
