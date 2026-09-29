/**
 * Archive/trash badge counts must distinguish "unknown" (not loaded yet, or the
 * last read failed) from a confirmed count — including a confirmed zero.
 *
 * A failed read is never allowed to become 0: it must preserve whatever count
 * (confirmed or still unknown) the UI already had.
 */
export type BucketCountResult = { ok: true; count: number } | { ok: false };

export function nextBucketCount(current: number | null, result: BucketCountResult): number | null {
  return result.ok ? result.count : current;
}
