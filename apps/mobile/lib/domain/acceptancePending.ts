/** Единый счётчик приёмки: WorkAcceptance + этапы review без дублей */
import type { Stage, WorkAcceptance } from '@/lib/api';

const PENDING_ACC = new Set(['requested', 'in_review']);

export function computePendingAcceptanceCount(
  stages: Stage[] | undefined,
  acceptances: WorkAcceptance[],
): number {
  const pending = acceptances.filter((a) => PENDING_ACC.has(a.status));
  const covered = new Set(pending.map((a) => a.stage_id));
  const orphanReview = (stages || []).filter((s) => s.status === 'review' && !covered.has(s.id)).length;
  return pending.length + orphanReview;
}

export type UnifiedAcceptanceItem =
  | { kind: 'acceptance'; id: string; stageId: string; title: string; sub: string; acceptanceId: string }
  | { kind: 'stage'; id: string; stageId: string; title: string; sub: string };

/** Список для UI приёмки без дублирования этапа и acceptance */
export function buildUnifiedAcceptanceItems(
  stages: Stage[] | undefined,
  acceptances: WorkAcceptance[],
): UnifiedAcceptanceItem[] {
  const pending = acceptances.filter((a) => PENDING_ACC.has(a.status));
  const covered = new Set(pending.map((a) => a.stage_id));
  const items: UnifiedAcceptanceItem[] = pending.map((a) => {
    // API иногда отдаёт pending без checklist_progress — не падаем на .done
    const done = a.checklist_progress?.done ?? 0;
    const total = a.checklist_progress?.total ?? 0;
    return {
      kind: 'acceptance' as const,
      id: `acc-${a.id}`,
      stageId: a.stage_id,
      acceptanceId: a.id,
      title: a.stage_name || 'Этап',
      sub: total > 0 ? `Чеклист ${done}/${total}` : 'Ждёт приёмки',
    };
  });
  for (const st of stages || []) {
    if (st.status === 'review' && !covered.has(st.id)) {
      items.push({
        kind: 'stage',
        id: `st-${st.id}`,
        stageId: st.id,
        title: st.name,
        sub: 'Ждёт приёмки',
      });
    }
  }
  return items;
}
