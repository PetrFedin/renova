/** Прогресс проекта — согласование dashboard, этапов и osSchedule */
import type { Stage } from '@/lib/api';

export function progressFromStages(stages: Stage[]): number | null {
  if (!stages.length) return null;
  const done = stages.filter((s) => s.status === 'done').length;
  return Math.round((done / stages.length) * 100);
}

export function resolveProjectProgress(
  stages: Stage[],
  dashProgress: number,
  osScheduleProgress?: number | null,
): number {
  if (osScheduleProgress != null && osScheduleProgress > 0) return osScheduleProgress;
  const fromStages = progressFromStages(stages);
  if (fromStages != null) {
    if (stages.every((s) => s.status === 'done')) return 100;
    if (fromStages > dashProgress) return fromStages;
  }
  return dashProgress || 0;
}
