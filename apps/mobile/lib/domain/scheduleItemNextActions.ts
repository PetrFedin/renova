/**
 * Клиентское зеркало backend schedule_item_transitions (P0).
 * Who: manage = contractor/foreman; customer = заказчик.
 */
import type { WorkScheduleItemStatus } from '@/lib/api/workSchedule';

type Who = 'manage' | 'customer';

const TRANSITIONS: Array<{ from: WorkScheduleItemStatus; to: WorkScheduleItemStatus; who: Who }> = [
  { from: 'planned', to: 'ready', who: 'manage' },
  { from: 'planned', to: 'in_progress', who: 'manage' },
  { from: 'planned', to: 'cancelled', who: 'manage' },
  { from: 'ready', to: 'in_progress', who: 'manage' },
  { from: 'ready', to: 'submitted', who: 'manage' },
  { from: 'ready', to: 'cancelled', who: 'manage' },
  { from: 'in_progress', to: 'submitted', who: 'manage' },
  { from: 'in_progress', to: 'blocked', who: 'manage' },
  { from: 'in_progress', to: 'cancelled', who: 'manage' },
  { from: 'blocked', to: 'in_progress', who: 'manage' },
  { from: 'blocked', to: 'cancelled', who: 'manage' },
  { from: 'submitted', to: 'accepted', who: 'customer' },
  { from: 'submitted', to: 'blocked', who: 'customer' },
  { from: 'delayed', to: 'in_progress', who: 'manage' },
  { from: 'delayed', to: 'blocked', who: 'manage' },
];

/** Приоритет «главного» следующего шага (одна CTA на пункт). */
const PRIMARY_ORDER: WorkScheduleItemStatus[] = [
  'ready',
  'in_progress',
  'submitted',
  'accepted',
  'blocked',
  'cancelled',
];

export const SCHEDULE_ITEM_STATUS_LABEL: Record<WorkScheduleItemStatus, string> = {
  planned: 'План',
  ready: 'Готов',
  in_progress: 'В работе',
  submitted: 'На приёмке',
  accepted: 'Принят',
  delayed: 'Сдвиг',
  blocked: 'Блок',
  cancelled: 'Отменён',
};

export const SCHEDULE_ITEM_ACTION_LABEL: Partial<Record<WorkScheduleItemStatus, string>> = {
  ready: 'К готовности',
  in_progress: 'Старт',
  submitted: 'На приёмку',
  accepted: 'Принять этап',
  blocked: 'Заблокировать',
  cancelled: 'Отменить',
};

export function nextScheduleItemActions(
  from: WorkScheduleItemStatus,
  who: Who,
): WorkScheduleItemStatus[] {
  return TRANSITIONS.filter((t) => t.from === from && t.who === who).map((t) => t.to);
}

/** Одна primary CTA + опционально secondary (block/cancel). */
export function primaryScheduleItemAction(
  from: WorkScheduleItemStatus,
  who: Who,
): WorkScheduleItemStatus | null {
  const next = nextScheduleItemActions(from, who);
  if (!next.length) return null;
  for (const pref of PRIMARY_ORDER) {
    if (next.includes(pref) && pref !== 'cancelled' && pref !== 'blocked') return pref;
  }
  // customer may only have accepted/blocked
  if (next.includes('accepted')) return 'accepted';
  return next[0] ?? null;
}
