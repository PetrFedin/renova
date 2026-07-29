export type VersionedQueueItem = {
  id: string;
  version?: number;
};

export type QueueFlushMutation<T extends VersionedQueueItem> = {
  id: string;
  expectedVersion: number;
  next: T | null;
};

/**
 * Applies completed flush results to the latest queue snapshot without
 * overwriting jobs that were added, removed or manually changed meanwhile.
 */
export function mergeQueueFlushMutations<T extends VersionedQueueItem>(
  current: T[],
  mutations: QueueFlushMutation<T>[],
): T[] {
  const byId = new Map(mutations.map((mutation) => [mutation.id, mutation]));
  const merged: T[] = [];

  for (const item of current) {
    const mutation = byId.get(item.id);
    if (!mutation) {
      merged.push(item);
      continue;
    }

    const currentVersion = item.version ?? 0;
    if (currentVersion !== mutation.expectedVersion) {
      merged.push(item);
      continue;
    }

    if (mutation.next) {
      merged.push({
        ...mutation.next,
        version: mutation.expectedVersion + 1,
      });
    }
  }

  return merged;
}
