import type {
  ResponsibilityBucketKey,
  ResponsibilityItem,
  ResponsibilityQueue,
} from '../api/types/os';

/** The API buckets describe item state, not who may act on it. */
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

/**
 * Home should show an actor-owned action before another person's overdue work.
 *
 * This is a read-only display decision: canonical API permissions still decide
 * whether an action is allowed. With no owned action, show the most urgent
 * waiting item but never label it as the viewer's task.
 */
export function selectActionQueueFocus(
  queue: ResponsibilityQueue | null,
  userId: string,
  readOnly = false,
): ActionQueueFocus | null {
  if (!queue || queue.count === 0) return null;

  const byBucket = queue.buckets
    ? PRIORITY.flatMap((key) => queue.buckets?.[key] ?? [])
    : [];
  const ordered = byBucket.length > 0 ? byBucket : queue.items;
  if (ordered.length === 0) return null;

  const own = !readOnly && userId
    ? ordered.find((item) => item.responsible_user_id === userId)
    : undefined;
  return { item: own ?? ordered[0], isMine: Boolean(own) };
}
