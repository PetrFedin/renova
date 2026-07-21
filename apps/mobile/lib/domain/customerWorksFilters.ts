/** Фильтры «Работы» для заказчика — взаимоисключающие состояния */
import type { Stage } from '@/lib/api';

export type CustomerWorksFilter = 'now' | 'awaiting' | 'problems' | 'all';

export const CUSTOMER_WORKS_FILTERS: { key: CustomerWorksFilter; label: string }[] = [
  { key: 'now', label: 'Сейчас' },
  { key: 'awaiting', label: 'Ждёт меня' },
  { key: 'problems', label: 'Проблемы' },
  { key: 'all', label: 'Все' },
];

function isProblemStage(
  s: Stage,
  blockedMap: Record<string, { blocked?: boolean }>,
  today: string,
): boolean {
  const overdue = !!(s.planned_end && s.planned_end < today && s.status !== 'done');
  return overdue || !!s.needs_rework || !!blockedMap[s.id]?.blocked;
}

/**
 * Вёдра без пересечений:
 * - awaiting — только приёмка (решение заказчика)
 * - problems — просрочка / доработка / блок (не чистая приёмка без риска)
 * - now — в работе сегодня, без приёмки и без проблем
 * - all — всё кроме done
 */
export function filterStagesForCustomer(
  stages: Stage[],
  filter: CustomerWorksFilter,
  blockedMap: Record<string, { blocked?: boolean }>,
  today: string,
): Stage[] {
  return stages.filter((s) => {
    if (filter === 'all') return s.status !== 'done';

    if (filter === 'awaiting') {
      // Только то, где заказчик должен принять / проверить
      return s.status === 'review';
    }

    const problem = isProblemStage(s, blockedMap, today);

    if (filter === 'problems') {
      // Приёмка без просрочки/доработки — в «Ждёт меня», не здесь
      if (s.status === 'review' && !s.needs_rework && !(s.planned_end && s.planned_end < today)) {
        return false;
      }
      return problem;
    }

    if (filter === 'now') {
      if (s.status === 'done' || s.status === 'review') return false;
      if (problem) return false;
      return (
        s.status === 'active'
        || s.planned_start === today
        || s.planned_end === today
      );
    }

    return true;
  });
}

/** Счётчики для чипов — чтобы сразу видно, что вкладки разные */
export function countStagesForCustomerFilters(
  stages: Stage[],
  blockedMap: Record<string, { blocked?: boolean }>,
  today: string,
): Record<CustomerWorksFilter, number> {
  return {
    now: filterStagesForCustomer(stages, 'now', blockedMap, today).length,
    awaiting: filterStagesForCustomer(stages, 'awaiting', blockedMap, today).length,
    problems: filterStagesForCustomer(stages, 'problems', blockedMap, today).length,
    all: filterStagesForCustomer(stages, 'all', blockedMap, today).length,
  };
}
