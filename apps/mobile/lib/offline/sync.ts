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
import { notifyOfflineFlush } from '@/lib/offline/flushBus';
import { notifyProjectDataChanged } from '@/lib/projectDataBus';

export type OfflineSyncResult = {
  total: number;
  synced: number;
  failed: number;
  skipped: number;
  conflicts: number;
};

export type OfflineOutboxStatus = OfflineQueueStatus;

let activeRun: Promise<OfflineSyncResult> | null = null;
let trailingRequested = false;

async function runOfflineFlush(apiBase: string): Promise<OfflineSyncResult> {
  let total = 0;
  let synced = 0;
  let failed = 0;
  let conflicts = 0;

  do {
    trailingRequested = false;
    const before = await getQueueStatus();
    total = Math.max(total, before.total);
    const result: OfflineFlushResult = await flush(apiBase);
    synced += result.synced;
    failed += result.failed;
    conflicts += result.conflicts;
  } while (trailingRequested);

  const after = await getQueueStatus();
  return {
    total,
    synced,
    failed,
    skipped: after.blocked + after.conflicts + after.deferred,
    conflicts,
  };
}

export function flushOfflineOutbox(apiBase: string = API_BASE): Promise<OfflineSyncResult> {
  if (activeRun) {
    trailingRequested = true;
    return activeRun;
  }

  activeRun = runOfflineFlush(apiBase).finally(() => {
    activeRun = null;
    notifyOfflineFlush();
  });

  return activeRun.then((result) => {
    if (result.synced > 0) notifyProjectDataChanged();
    return result;
  });
}

export async function getOfflineOutboxStatus(): Promise<OfflineOutboxStatus> {
  return getQueueStatus();
}

export async function getOfflineOutboxSize() {
  const status = await getOfflineOutboxStatus();
  return status.pending;
}

export function isOfflineSyncRunning() {
  return activeRun !== null;
}
