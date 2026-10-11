import type { BlockedWorkHandoff, ResponsibilityQueue } from '@/lib/api';

type BlockedDestination = 'control' | 'works' | 'materials';

export function hasActionQueueContent(queue: ResponsibilityQueue | null): boolean {
  return Boolean(queue && (
    queue.items.length > 0 ||
    (queue.blocked_work?.items.length ?? 0) > 0
  ));
}

/** Navigation is only an entrypoint; domain mutations remain in canonical screens. */
export function blockedWorkDestination(
  blocker: Pick<BlockedWorkHandoff, 'blocker_type' | 'handoff_action'>,
): BlockedDestination {
  if (blocker.handoff_action === 'decide_work_acceptance') return 'control';
  if (blocker.blocker_type === 'material') return 'materials';
  return 'works';
}

/** If canonical work is blocked but no human responsibility items exist, do not show six misleading zero counters. */
export function isBlockedOnlyQueue(queue: ResponsibilityQueue | null): boolean {
  return Boolean(queue && queue.items.length === 0 && (queue.blocked_work?.items.length ?? 0) > 0);
}

export type HandoffVisibility = 'mine' | 'other' | 'external' | 'hidden' | 'unassigned';

/** Never derive another user's identity from an inaccessible dependency. */
export function blockedHandoffVisibility(
  blocker: Pick<BlockedWorkHandoff, 'handoff_kind' | 'handoff_user_id'>,
  userId: string,
): HandoffVisibility {
  if (blocker.handoff_kind === 'hidden') return 'hidden';
  if (blocker.handoff_kind === 'external') return 'external';
  if (blocker.handoff_user_id && blocker.handoff_user_id === userId) return 'mine';
  if (blocker.handoff_user_id) return 'other';
  return 'unassigned';
}
