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

export function workActions(
  status: WorkOrderStatus,
  role: 'customer' | 'contractor',
): WorkTransitionAction[] {
  return (WORK_TRANSITIONS[status] || [])
    .filter((next) => isTransitionAllowedForRole(status, next, role))
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
): boolean {
  if (!(WORK_TRANSITIONS[from] || []).includes(to)) return false;
  if (to === 'done') return role === 'customer';
  if (to === 'review') return role === 'contractor';
  if (to === 'approved') return role === 'customer';
  if (from === 'review' && to === 'in_progress') return true;
  if (from === 'approved' && to === 'in_progress') return role === 'contractor';
  if (to === 'published' || to === 'negotiating' || to === 'cancelled') return true;
  return false;
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
