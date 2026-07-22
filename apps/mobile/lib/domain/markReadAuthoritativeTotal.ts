/**
 * One-shot handoff authoritative total из POST /read к следующему snapshot patch.
 *
 * API и store исторически разделены: API возвращает total_unread_count, а store
 * вызывает patchThreadUnreadInSnapshot отдельным шагом. Пока store не передаёт
 * total аргументом напрямую, этот keyed handoff сохраняет серверный SoT без
 * глобального пересчёта по загруженному массиву threads.
 */

const stagedTotals = new Map<string, number>();

function normalizeTotal(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.trunc(value));
}

export function stageMarkReadAuthoritativeTotal(threadId: string, total: unknown): void {
  const id = threadId.trim();
  const normalized = normalizeTotal(total);
  if (!id || normalized == null) return;
  stagedTotals.set(id, normalized);
}

/** Возвращает и удаляет staged total: один POST /read → один patch. */
export function consumeMarkReadAuthoritativeTotal(threadId: string): number | undefined {
  const id = threadId.trim();
  if (!id) return undefined;
  const total = stagedTotals.get(id);
  stagedTotals.delete(id);
  return total;
}

export function clearMarkReadAuthoritativeTotals(): void {
  stagedTotals.clear();
}
