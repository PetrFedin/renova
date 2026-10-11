import { blockedWorkDestination, hasActionQueueContent, isBlockedOnlyQueue, blockedHandoffVisibility } from './actionQueuePresentation';
import type { ResponsibilityQueue } from '@/lib/api';

const queue = { project_id: 'p1', count: 0, items: [], blocked_work: { count: 1, blocked_stage_count: 1, items: [{
  stage_id: 's1', stage_title: 'Этап', stage_status: 'planned', blocker_type: 'work',
  blocker_title: 'Ждёт предыдущую работу', criticality: 'high', handoff_kind: 'hidden',
  handoff_action: 'wait_hidden_dependency',
}] } } as ResponsibilityQueue;

if (!hasActionQueueContent(queue)) throw new Error('blocked work must remain visible when action count is zero');
if (hasActionQueueContent({ ...queue, blocked_work: { count: 0, blocked_stage_count: 0, items: [] } })) throw new Error('empty queue must be hidden');
if (hasActionQueueContent(null)) throw new Error('null queue must be hidden');
if (blockedWorkDestination({ blocker_type: 'work', handoff_action: 'decide_work_acceptance' }) !== 'control') throw new Error('review handoff must open Control');
if (blockedWorkDestination({ blocker_type: 'material', handoff_action: 'provide_material' }) !== 'materials') throw new Error('material handoff must open Materials');
if (blockedWorkDestination({ blocker_type: 'work', handoff_action: 'complete_dependency_stage' }) !== 'works') throw new Error('work handoff must open Works');
console.log('actionQueuePresentation.test OK');

if (!isBlockedOnlyQueue(queue)) throw new Error('blocked-only state must be explicit');
if (isBlockedOnlyQueue({ ...queue, items: [{ resource_type: 'issue' }] } as ResponsibilityQueue)) throw new Error('mixed queue not blocked-only');
if (blockedHandoffVisibility({ handoff_kind: 'hidden', handoff_user_id: 'user-a' }, 'user-a') !== 'hidden') throw new Error('hidden dependency must not reveal actor');
if (blockedHandoffVisibility({ handoff_kind: 'external', handoff_user_id: null }, 'user-a') !== 'external') throw new Error('external handoff');
if (blockedHandoffVisibility({ handoff_kind: 'work', handoff_user_id: 'user-a' }, 'user-a') !== 'mine') throw new Error('mine handoff');
if (blockedHandoffVisibility({ handoff_kind: 'work', handoff_user_id: 'user-b' }, 'user-a') !== 'other') throw new Error('other handoff');
