import type {
  ResponsibilityBucketKey,
  ResponsibilityItem,
  ResponsibilityQueue,
} from '../api/types/os';

/** Server buckets express domain state, not actor capability. */
const PRIORITY: ResponsibilityBucketKey[] = [
  'overdue',
  'needs_evidence',
  'waiting_review',
  'waiting_owner_decision',
  'mine_now',
  'waiting_other',
];

export type ActionQueueFocus = {
  item: ResponsibilityItem;
  isMine: boolean;
};

export type ActionQueueFilter = 'all' | 'mine' | 'waiting';

export type ActionQueueRow = ActionQueueFocus & {
  key: string;
  bucket: ResponsibilityBucketKey | null;
};

/**
 * The read model is already project/participant scoped by the backend.
 * Never infer mutation authority from a bucket or expose an action as mine
 * merely because it is urgent. Actual permissions remain server-enforced.
 */
export function getActionQueueRows(
  queue: ResponsibilityQueue | null,
  userId: string,
  readOnly = false,
): ActionQueueRow[] {
  if (!queue || queue.count === 0) return [];

  const rows: ActionQueueRow[] = [];
  const seen = new Set<string>();
  const append = (item: ResponsibilityItem, bucket: ResponsibilityBucketKey | null) => {
    const key = [item.resource_type, item.resource_id, item.action].join(':');
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({
      key,
      item,
      bucket,
      isMine: Boolean(!readOnly && userId && item.responsible_user_id === userId),
    });
  };

  // The six server-defined bucket types retain their established priority.
  // If a legacy/partial response omits buckets, keep every scoped API item.
  if (queue.buckets) {
    for (const bucket of PRIORITY) {
      for (const item of queue.buckets[bucket] ?? []) append(item, bucket);
    }
  }
  for (const item of queue.items) append(item, null);

  // Own assignments come first; within each group server priority is stable.
  return [
    ...rows.filter((row) => row.isMine),
    ...rows.filter((row) => !row.isMine),
  ];
}

export function filterActionQueueRows(
  rows: ActionQueueRow[],
  filter: ActionQueueFilter,
): ActionQueueRow[] {
  switch (filter) {
    case 'mine':
      return rows.filter((row) => row.isMine);
    case 'waiting':
      return rows.filter((row) => !row.isMine);
    default:
      return rows;
  }
}

/** Keep the compact Home CTA and expanded list on one shared selection rule. */
export function selectActionQueueFocus(
  queue: ResponsibilityQueue | null,
  userId: string,
  readOnly = false,
): ActionQueueFocus | null {
  const row = getActionQueueRows(queue, userId, readOnly)[0];
  return row ? { item: row.item, isMine: row.isMine } : null;
}
