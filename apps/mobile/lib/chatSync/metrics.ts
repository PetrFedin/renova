import type { ChatSyncMetrics } from './types';

export function createEmptyMetrics(): ChatSyncMetrics {
  return {
    syncRequests: 0,
    coalescedRequests: 0,
    cancelledRequests: 0,
    wsReconnects: 0,
    reconciliationFailures: 0,
    appliedResponses: 0,
    droppedStaleResponses: 0,
  };
}

/** Снимок без PII — только счётчики */
export function snapshotMetrics(m: ChatSyncMetrics): ChatSyncMetrics {
  return { ...m };
}
