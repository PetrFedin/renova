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
