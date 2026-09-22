/**
 * Доработка этапа — это флаг `needs_rework`, а не статус.
 *
 * StageStatus на сервере знает только planned / active / review / done.
 * Сравнение `stage.status === 'rework'` не совпадало никогда: раздел
 * «Доработка» не показывался, а счётчик доработок всегда был нулём.
 * Возврат на доработку выставляет `needs_rework`, приёмка его снимает —
 * это и есть источник правды.
 */
import type { Stage } from '@/lib/api/types/stage';

type ReworkAware = Pick<Stage, 'status'> & { needs_rework?: boolean };

export function stageNeedsRework(stage: ReworkAware): boolean {
  // Завершённый этап в доработке не нуждается: флаг там — остаток прошлого
  // круга, и показывать его значило бы звать переделывать принятое.
  if (stage.status === 'done') return false;
  return stage.needs_rework === true;
}

export function reworkStages<T extends ReworkAware>(stages: readonly T[]): T[] {
  return stages.filter(stageNeedsRework);
}

/** Подпись этапа для сводок: доработка важнее самого статуса. */
export function stageShortStatusLabel(
  stage: ReworkAware,
  labels: Record<string, string>,
): string {
  if (stageNeedsRework(stage)) return 'Доработка';
  return labels[stage.status] || stage.status;
}
