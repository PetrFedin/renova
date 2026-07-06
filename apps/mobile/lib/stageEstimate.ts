import type { EstimateLine } from '@/lib/api';

/** Строки сметы в scope этапа (по room_ids) */
export function filterLinesForStage(lines: EstimateLine[], roomIds?: string[] | null): EstimateLine[] {
  if (!roomIds?.length) return lines;
  return lines.filter((l) => l.room_id && roomIds.includes(l.room_id));
}

export function sumEstimateLines(lines: EstimateLine[]): number {
  return lines.reduce((a, l) => a + l.quantity_planned * l.unit_price, 0);
}

/** План этапа из сметы (room_ids), fallback — payment_amount */
export function stagePlanFromEstimate(stage: { room_ids?: string[] | null; payment_amount?: number }, lines: EstimateLine[]): number {
  const fromEstimate = sumEstimateLines(filterLinesForStage(lines, stage.room_ids));
  if (fromEstimate > 0) return fromEstimate;
  return stage.payment_amount || 0;
}
