/** Единый счётчик приёмки: WorkAcceptance + этапы review без дублей */
import type { Stage, WorkAcceptance } from '@/lib/api';

const PENDING_ACC = new Set(['requested', 'in_review']);

export function computePendingAcceptanceCount(
  stages: Stage[] | undefined,
  acceptances: WorkAcceptance[],
): number {
  const pending = acceptances.filter((acceptance) => PENDING_ACC.has(acceptance.status));
  const covered = new Set(pending.map((acceptance) => acceptance.stage_id));
  const orphanReview = (stages || []).filter((stage) => stage.status === 'review' && !covered.has(stage.id)).length;
  return pending.length + orphanReview;
}

export type UnifiedAcceptanceItem =
  | { kind: 'acceptance'; id: string; stageId: string; title: string; sub: string; acceptanceId: string }
  | { kind: 'stage'; id: string; stageId: string; title: string; sub: string };

function stageAcceptanceSubtitle(stage: Stage | undefined): string {
  if (typeof stage?.checklist_progress === 'number' && Number.isFinite(stage.checklist_progress) && stage.checklist_progress > 0) {
    return `Чеклист ${Math.max(0, Math.min(100, Math.round(stage.checklist_progress)))}%`;
  }
  return 'Ждёт приёмки';
}

/**
 * Список для UI приёмки без дублирования этапа и acceptance.
 * Canonical acceptance API does not expose stage_name/checklist_progress, so
 * presentation data is joined from the project stage read-model by stage_id.
 */
export function buildUnifiedAcceptanceItems(
  stages: Stage[] | undefined,
  acceptances: WorkAcceptance[],
): UnifiedAcceptanceItem[] {
  const stageList = stages || [];
  const stageById = new Map(stageList.map((stage) => [stage.id, stage]));
  const pending = acceptances.filter((acceptance) => PENDING_ACC.has(acceptance.status));
  const covered = new Set(pending.map((acceptance) => acceptance.stage_id));
  const items: UnifiedAcceptanceItem[] = pending.map((acceptance) => {
    const stage = stageById.get(acceptance.stage_id);
    return {
      kind: 'acceptance' as const,
      id: `acc-${acceptance.id}`,
      stageId: acceptance.stage_id,
      acceptanceId: acceptance.id,
      title: stage?.name || 'Этап',
      sub: stageAcceptanceSubtitle(stage),
    };
  });
  for (const stage of stageList) {
    if (stage.status === 'review' && !covered.has(stage.id)) {
      items.push({
        kind: 'stage',
        id: `st-${stage.id}`,
        stageId: stage.id,
        title: stage.name,
        sub: stageAcceptanceSubtitle(stage),
      });
    }
  }
  return items;
}
