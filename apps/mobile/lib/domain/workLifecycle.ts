/** Жизненный цикл детальной работы (WorkOrder) — единый для mobile и backend. */
export type WorkOrderStatus =
  | 'draft'
  | 'published'
  | 'negotiating'
  | 'approved'
  | 'in_progress'
  | 'review'
  | 'done'
  | 'paid'
  | 'cancelled';

export type WorkActionIntent = 'primary' | 'secondary' | 'destructive';

export type WorkTransitionAction = {
  label: string;
  next: WorkOrderStatus;
  intent: WorkActionIntent;
};

export const WORK_STATUS_LABEL: Record<WorkOrderStatus, string> = {
  draft: 'Черновик',
  published: 'Опубликовано',
  negotiating: 'Обсуждение',
  approved: 'Согласовано',
  in_progress: 'В работе',
  review: 'На приёмке',
  done: 'Выполнено',
  paid: 'Оплачено',
  cancelled: 'Отменено',
};

/**
 * Только операционные переходы. `paid` не выставляется generic transition:
 * деньги подтверждаются в PaymentDetailSheet и банковском/чековом контуре.
 */
export const WORK_TRANSITIONS: Record<WorkOrderStatus, WorkOrderStatus[]> = {
  draft: ['published', 'cancelled'],
  published: ['negotiating', 'approved', 'cancelled'],
  negotiating: ['approved', 'cancelled'],
  approved: ['in_progress', 'cancelled'],
  in_progress: ['review', 'cancelled'],
  review: ['done', 'in_progress'],
  done: [],
  paid: [],
  cancelled: [],
};

/** Исполнительские шаги, которые сервер разрешает заказчику, когда исполняет он сам. */
const EXECUTOR_STEPS: ReadonlyArray<[WorkOrderStatus, WorkOrderStatus]> = [
  ['approved', 'in_progress'],
  ['in_progress', 'review'],
];

export type WorkRoleOptions = {
  /** Заказчик исполняет работу сам (зеркало `customer_can_execute_work_order`). */
  customerCanExecute?: boolean;
};

/**
 * Зеркало backend: заказчик исполняет работу, если она назначена на него,
 * либо в проекте нет исполнителя и работа ни на кого не назначена (REP-02).
 */
export function customerCanExecuteWork(input: {
  projectHasContractor: boolean;
  assigneeId?: string | null;
  userId?: string | null;
}): boolean {
  if (input.assigneeId && input.userId && input.assigneeId === input.userId) return true;
  return !input.projectHasContractor && !input.assigneeId;
}

export function workActions(
  status: WorkOrderStatus,
  role: 'customer' | 'contractor',
  opts?: WorkRoleOptions,
): WorkTransitionAction[] {
  return (WORK_TRANSITIONS[status] || [])
    .filter((next) => isTransitionAllowedForRole(status, next, role, opts))
    .map((next) => ({
      next,
      label: actionLabel(status, next, role),
      intent: actionIntent(status, next, role),
    }))
    .filter((action) => action.label);
}

export function isTransitionAllowedForRole(
  from: WorkOrderStatus,
  to: WorkOrderStatus,
  role: 'customer' | 'contractor',
  opts?: WorkRoleOptions,
): boolean {
  if (!(WORK_TRANSITIONS[from] || []).includes(to)) return false;
  if (role === 'customer' && opts?.customerCanExecute && EXECUTOR_STEPS.some(([a, b]) => a === from && b === to)) return true;
  if (to === 'done') return role === 'customer';
  if (to === 'review') return role === 'contractor';
  if (to === 'approved') return role === 'customer';
  if (from === 'review' && to === 'in_progress') return true;
  if (from === 'approved' && to === 'in_progress') return role === 'contractor';
  if (to === 'published' || to === 'negotiating' || to === 'cancelled') return true;
  return false;
}

/** Порядок состояний по движению к завершению. Нужен, чтобы отличить
 *  движение вперёд от возврата на доработку: `review → in_progress` разрешён
 *  обеим сторонам, но это шаг назад, а не следующий шаг. */
const WORK_RANK: Record<WorkOrderStatus, number> = {
  draft: 0,
  published: 1,
  negotiating: 2,
  approved: 3,
  in_progress: 4,
  review: 5,
  done: 6,
  paid: 7,
  cancelled: -1,
};

function advancingTargets(status: WorkOrderStatus): WorkOrderStatus[] {
  return (WORK_TRANSITIONS[status] || []).filter(
    (next) => next !== 'cancelled' && WORK_RANK[next] > WORK_RANK[status],
  );
}

/**
 * Чей ход, когда у текущей роли вперёд ходов нет.
 *
 * Экран печатал заголовок «Следующий шаг» и под ним — всё, что доступно роли.
 * На согласованной работе у заказчика остаётся единственное действие
 * «Отменить работу»: начать работу может только исполнитель. Получалось, что
 * следующим шагом экран называет отмену, хотя на самом деле нужно просто
 * дождаться исполнителя. Здесь считается, кто ходит на самом деле.
 *
 * `null` — ждать некого: либо у роли есть свой ход вперёд, либо работа
 * в конечном состоянии.
 */
export function waitingForRole(
  status: WorkOrderStatus,
  role: 'customer' | 'contractor',
  opts?: WorkRoleOptions,
): 'customer' | 'contractor' | null {
  const forward = advancingTargets(status);
  if (!forward.length) return null;
  if (forward.some((next) => isTransitionAllowedForRole(status, next, role, opts))) return null;
  const other: 'customer' | 'contractor' = role === 'customer' ? 'contractor' : 'customer';
  return forward.some((next) => isTransitionAllowedForRole(status, next, other)) ? other : null;
}

/** Что написать на экране вместо обещания следующего шага. */
export function waitingForText(status: WorkOrderStatus, role: 'customer' | 'contractor', opts?: WorkRoleOptions): string | null {
  const who = waitingForRole(status, role, opts);
  if (!who) return null;
  const actor = who === 'contractor' ? 'исполнителя' : 'заказчика';
  const what = nextStepHint(status, who);
  return what ? `Ход за ${actor}: ${what}` : `Ход за ${actor}`;
}

function nextStepHint(status: WorkOrderStatus, who: 'customer' | 'contractor'): string {
  const next = advancingTargets(status).find((n) => isTransitionAllowedForRole(status, n, who));
  if (!next) return '';
  return actionLabel(status, next, who).toLowerCase();
}

export function hasCanonicalPaymentAction(
  status: WorkOrderStatus,
  role: 'customer' | 'contractor',
): boolean {
  return status === 'done' && role === 'customer';
}

function actionLabel(from: WorkOrderStatus, to: WorkOrderStatus, role: 'customer' | 'contractor'): string {
  if (to === 'published') return 'Опубликовать';
  if (to === 'negotiating') return 'Обсудить в чате';
  if (to === 'approved') return 'Согласовать';
  if (from === 'review' && to === 'in_progress') {
    return role === 'customer' ? 'Вернуть на доработку' : 'Вернуть в работу';
  }
  if (to === 'in_progress') return 'Начать работу';
  if (to === 'review') return 'Передать на приёмку';
  if (to === 'done') return 'Принять результат';
  if (to === 'cancelled') return 'Отменить работу';
  return to;
}

function actionIntent(
  from: WorkOrderStatus,
  to: WorkOrderStatus,
  role: 'customer' | 'contractor',
): WorkActionIntent {
  if (to === 'cancelled') return 'destructive';
  if (to === 'negotiating') return 'secondary';
  if (from === 'review' && to === 'in_progress' && role === 'customer') return 'secondary';
  return 'primary';
}
