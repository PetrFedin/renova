import type { Stage, WorkAcceptance } from '@/lib/api';
import { computePendingAcceptanceCount, buildUnifiedAcceptanceItems } from './acceptancePending';

function stage(input: Pick<Stage, 'id' | 'name' | 'status'> & Partial<Stage>): Stage {
  return {
    sort_order: 0,
    percent_complete: 0,
    payment_amount: 0,
    ...input,
  };
}

function acceptance(
  input: Pick<WorkAcceptance, 'id' | 'stage_id' | 'status'> & Partial<WorkAcceptance>,
): WorkAcceptance {
  return {
    project_id: 'p1',
    room_id: null,
    requested_by: 'contractor-1',
    accepted_by: null,
    requested_at: '2026-08-07T12:00:00Z',
    accepted_at: null,
    checklist: [],
    quality_score: null,
    comment: null,
    created_at: '2026-08-07T12:00:00Z',
    ...input,
  };
}

const stages: Stage[] = [
  stage({ id: 's1', name: 'A', status: 'review' }),
  stage({ id: 's2', name: 'B', status: 'active', checklist_progress: 34 }),
];

const acceptances: WorkAcceptance[] = [
  acceptance({ id: 'a1', stage_id: 's2', status: 'requested' }),
];

const count = computePendingAcceptanceCount(stages, acceptances);
if (count !== 2) throw new Error(`expected 2 pending, got ${count}`);

const items = buildUnifiedAcceptanceItems(stages, acceptances);
if (items.length !== 2) throw new Error(`expected 2 items, got ${items.length}`);
if (!items.some((item) => item.kind === 'stage' && item.stageId === 's1')) {
  throw new Error('missing orphan review stage');
}
const joined = items.find((item) => item.kind === 'acceptance' && item.acceptanceId === 'a1');
if (!joined) throw new Error('missing acceptance');
if (joined.title !== 'B') throw new Error(`expected stage title B, got ${joined.title}`);
if (joined.sub !== 'Чеклист 34%') throw new Error(`expected stage checklist progress, got ${joined.sub}`);

// Canonical acceptance wire response has no stage_name/checklist_progress. If its
// stage read-model is absent, the UI must remain usable with a truthful fallback.
const noStage = buildUnifiedAcceptanceItems([], [
  acceptance({ id: 'a2', stage_id: 'missing-stage', status: 'in_review' }),
]);
if (noStage.length !== 1) throw new Error('expected 1 item without a joined stage');
if (noStage[0].title !== 'Этап') throw new Error(`unexpected title: ${noStage[0].title}`);
if (noStage[0].sub !== 'Ждёт приёмки') throw new Error(`unexpected sub: ${noStage[0].sub}`);

console.log('acceptancePending.test OK');
