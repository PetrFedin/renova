/**
 * One-shot handoff authoritative total из POST /read к следующему snapshot patch.
 *
 * API и store исторически разделены: API возвращает total_unread_count, а store
 * вызывает patchThreadUnreadInSnapshot отдельным шагом. Пока store не передаёт
 * total аргументом напрямую, этот keyed handoff сохраняет серверный SoT без
 * глобального пересчёта по загруженному массиву threads.
 */

type StagedTotal = {
  total: number;
  stagedAt: number;
};

const stagedTotals = new Map<string, StagedTotal>();
const STAGED_TOTAL_TTL_MS = 30_000;
const STAGED_TOTAL_MAX = 100;

function normalizeTotal(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.trunc(value));
}

function trimStagedTotalsToMax(): void {
  while (stagedTotals.size > STAGED_TOTAL_MAX) {
    const first = stagedTotals.keys().next().value;
    if (first == null) break;
    stagedTotals.delete(first);
  }
}

function pruneStagedTotals(now: number): void {
  for (const [threadId, entry] of stagedTotals) {
    if (now - entry.stagedAt > STAGED_TOTAL_TTL_MS) {
      stagedTotals.delete(threadId);
    }
  }
  trimStagedTotalsToMax();
}

export function stageMarkReadAuthoritativeTotal(
  threadId: string,
  total: unknown,
  now = Date.now(),
): void {
  const id = threadId.trim();
  if (!id) return;

  pruneStagedTotals(now);
  const normalized = normalizeTotal(total);
  if (normalized == null) {
    // Новый POST /read без authoritative total не должен переиспользовать
    // значение, оставшееся от предыдущего запроса того же треда.
    stagedTotals.delete(id);
    return;
  }

  // Refresh insertion order so eviction removes the oldest staged request.
  stagedTotals.delete(id);
  stagedTotals.set(id, { total: normalized, stagedAt: now });
  trimStagedTotalsToMax();
}

/** Возвращает и удаляет staged total: один POST /read → один patch. */
export function consumeMarkReadAuthoritativeTotal(
  threadId: string,
  now = Date.now(),
): number | undefined {
  const id = threadId.trim();
  if (!id) return undefined;
  const entry = stagedTotals.get(id);
  stagedTotals.delete(id);
  if (!entry || now - entry.stagedAt > STAGED_TOTAL_TTL_MS) return undefined;
  return entry.total;
}

export function clearMarkReadAuthoritativeTotals(): void {
  stagedTotals.clear();
}
