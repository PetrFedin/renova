/**
 * STG-007: ревизия подтверждённого графика.
 * Подтверждённый график действует, пока заказчик не подтвердит ревизию — поэтому
 * `/work-schedules/active` всегда отдаёт подтверждённый, а ожидающую ревизию
 * нужно искать в общем списке по `supersedes_id`.
 */
import type { WorkSchedule, WorkScheduleItem } from '@/lib/api/workSchedule';

export const SCHEDULE_REVISION_NOTICE =
  'Действует подтверждённый график; изменение вступит после подтверждения заказчиком.';

const OPEN_STATUSES = ['draft', 'submitted', 'rejected'];

type ScheduleLike = Pick<WorkSchedule, 'id' | 'status'> & { supersedes_id?: string | null };

export function findOpenRevision<T extends ScheduleLike>(active: ScheduleLike | null | undefined, all: readonly T[] | null | undefined): T | null {
  if (!active || active.status !== 'confirmed') return null;
  return (all ?? []).find((row) => row.supersedes_id === active.id && OPEN_STATUSES.includes(row.status)) ?? null;
}

export type ScheduleRevisionActions = {
  canRequest: boolean;
  canSubmit: boolean;
  canConfirm: boolean;
  canReject: boolean;
  /** Текст-пояснение для текущей роли и состояния; null — показывать нечего. */
  message: string | null;
};

export function scheduleRevisionActions(input: {
  role: 'customer' | 'contractor';
  /** Владелец/прораб бригады исполнителя (или заказчик). */
  canManage: boolean;
  readOnly?: boolean;
  active: ScheduleLike | null | undefined;
  revision: ScheduleLike | null | undefined;
}): ScheduleRevisionActions {
  const none: ScheduleRevisionActions = { canRequest: false, canSubmit: false, canConfirm: false, canReject: false, message: null };
  const { active, revision, role } = input;
  if (!active || active.status !== 'confirmed') return none;
  const writable = !input.readOnly;
  const contractor = role === 'contractor' && input.canManage && writable;
  const customer = role === 'customer' && writable;

  if (!revision) {
    return {
      ...none,
      canRequest: contractor,
      message: role === 'contractor' ? SCHEDULE_REVISION_NOTICE : null,
    };
  }
  if (revision.status === 'submitted') {
    return {
      ...none,
      canConfirm: customer,
      canReject: customer,
      message: role === 'customer'
        ? 'Исполнитель просит изменить подтверждённый график. До вашего решения действует прежний график.'
        : 'Изменение отправлено заказчику. До его решения действует прежний график.',
    };
  }
  // draft | rejected
  return {
    ...none,
    canSubmit: contractor,
    message: role === 'customer'
      ? 'Исполнитель готовит изменения графика. Они появятся у вас после отправки.'
      : revision.status === 'rejected'
        ? 'Заказчик отклонил изменение. Прежний график продолжает действовать — можно отправить изменение повторно.'
        : SCHEDULE_REVISION_NOTICE,
  };
}

export type RevisionItemChange = { title: string; kind: 'added' | 'removed' | 'moved'; from?: string; to?: string };

const keyOf = (item: Pick<WorkScheduleItem, 'stage_id' | 'title'>) => item.stage_id || `t:${item.title}`;
const range = (item: Pick<WorkScheduleItem, 'planned_start_date' | 'planned_finish_date'>) =>
  `${item.planned_start_date} — ${item.planned_finish_date}`;

/** Что изменилось в ревизии относительно действующего графика (для решения заказчика). */
export function diffRevisionItems(
  active: readonly Pick<WorkScheduleItem, 'stage_id' | 'title' | 'planned_start_date' | 'planned_finish_date'>[],
  revision: readonly Pick<WorkScheduleItem, 'stage_id' | 'title' | 'planned_start_date' | 'planned_finish_date'>[],
): RevisionItemChange[] {
  const before = new Map(active.map((item) => [keyOf(item), item]));
  const after = new Map(revision.map((item) => [keyOf(item), item]));
  const changes: RevisionItemChange[] = [];
  for (const [key, next] of after) {
    const prev = before.get(key);
    if (!prev) changes.push({ title: next.title, kind: 'added', to: range(next) });
    else if (range(prev) !== range(next)) changes.push({ title: next.title, kind: 'moved', from: range(prev), to: range(next) });
  }
  for (const [key, prev] of before) {
    if (!after.has(key)) changes.push({ title: prev.title, kind: 'removed', from: range(prev) });
  }
  return changes;
}
