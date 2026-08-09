export type OfflineQueueStorageFailure = 'invalid_json' | 'invalid_shape' | 'invalid_job';

/**
 * Storage integrity error for the canonical offline mutation queue.
 * Never attach the raw payload: queued mutation bodies can contain user data.
 */
export class OfflineQueueStorageError extends Error {
  readonly code = 'offline_queue_storage_corrupt';

  constructor(
    readonly storageKey: string,
    readonly reason: OfflineQueueStorageFailure,
    readonly itemIndex?: number,
  ) {
    super(
      itemIndex === undefined
        ? `offline_queue_storage_corrupt:${reason}`
        : `offline_queue_storage_corrupt:${reason}:${itemIndex}`,
    );
    this.name = 'OfflineQueueStorageError';
  }
}

/**
 * Missing storage is a legitimate empty queue. Malformed storage is not.
 * Callers must surface/retry corruption instead of pretending all mutations synced.
 */
export function parseOfflineQueueStorage(raw: string | null, storageKey: string): unknown[] {
  if (raw === null) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new OfflineQueueStorageError(storageKey, 'invalid_json');
  }

  if (!Array.isArray(parsed)) {
    throw new OfflineQueueStorageError(storageKey, 'invalid_shape');
  }

  return parsed;
}
