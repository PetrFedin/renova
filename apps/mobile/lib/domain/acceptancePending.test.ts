import { computePendingAcceptanceCount, buildUnifiedAcceptanceItems } from './acceptancePending';

const stages = [
  { id: 's1', name: 'A', status: 'review' },
  { id: 's2', name: 'B', status: 'active' },
] as any[];

const acceptances = [
  { id: 'a1', stage_id: 's2', stage_name: 'B', status: 'requested', checklist_progress: { done: 1, total: 3 } },
] as any[];

const count = computePendingAcceptanceCount(stages, acceptances);
if (count !== 2) throw new Error(`expected 2 pending, got ${count}`);

const items = buildUnifiedAcceptanceItems(stages, acceptances);
if (items.length !== 2) throw new Error(`expected 2 items, got ${items.length}`);
if (!items.some((i) => i.kind === 'stage' && i.stageId === 's1')) throw new Error('missing orphan review stage');
if (!items.some((i) => i.kind === 'acceptance' && i.acceptanceId === 'a1')) throw new Error('missing acceptance');

console.log('acceptancePending.test OK');
