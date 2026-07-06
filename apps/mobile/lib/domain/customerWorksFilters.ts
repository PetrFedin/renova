/** Фильтры «Работы» для заказчика — 4 понятных состояния */
import type { Stage } from '@/lib/api';

export type CustomerWorksFilter = 'now' | 'awaiting' | 'problems' | 'all';

export const CUSTOMER_WORKS_FILTERS: { key: CustomerWorksFilter; label: string }[] = [
  { key: 'now', label: 'Сейчас' },
  { key: 'awaiting', label: 'Ждёт меня' },
  { key: 'problems', label: 'Проблемы' },
  { key: 'all', label: 'Все' },
];

export function filterStagesForCustomer(
  stages: Stage[],
  filter: CustomerWorksFilter,
  blockedMap: Record<string, { blocked?: boolean }>,
  today: string,
): Stage[] {
  return stages.filter((s) => {
    if (filter === 'all') return s.status !== 'done';
    if (filter === 'awaiting') return s.status === 'review';
    if (filter === 'now') {
      return (
        s.status === 'active'
        || s.status === 'review'
        || s.planned_start === today
        || s.planned_end === today
      );
    }
    if (filter === 'problems') {
      const overdue = !!(s.planned_end && s.planned_end < today && s.status !== 'done');
      return overdue || !!s.needs_rework || !!blockedMap[s.id]?.blocked;
    }
    return true;
  });
}
