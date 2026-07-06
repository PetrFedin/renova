/** Жизненный цикл детальной работы (WorkOrder) — единый для календаря, чата, бюджета */
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

/** Допустимые переходы — зеркало backend work_order_service */
export const WORK_TRANSITIONS: Record<WorkOrderStatus, WorkOrderStatus[]> = {
  draft: ['published', 'cancelled'],
  published: ['negotiating', 'approved', 'cancelled'],
  negotiating: ['approved', 'cancelled'],
  approved: ['in_progress', 'cancelled'],
  in_progress: ['review', 'cancelled'],
  review: ['done', 'in_progress'],
  done: ['paid'],
  paid: [],
  cancelled: [],
};

/** Кнопки действий по роли */
export function workActions(status: WorkOrderStatus, role: 'customer' | 'contractor'): { label: string; next: WorkOrderStatus }[] {
  const next = WORK_TRANSITIONS[status] || [];
  return next.map((n) => ({
    next: n,
    label: actionLabel(status, n, role),
  })).filter((a) => a.label);
}

function actionLabel(from: WorkOrderStatus, to: WorkOrderStatus, role: 'customer' | 'contractor'): string {
  if (to === 'published') return 'Опубликовать';
  if (to === 'negotiating') return 'Обсудить в чате';
  if (to === 'approved') return role === 'customer' ? 'Согласовать' : 'Отправить на согласование';
  if (to === 'in_progress') return 'Начать работу';
  if (to === 'review') return 'На приёмку';
  if (to === 'done') return role === 'customer' ? 'Принять результат' : 'Завершить';
  if (to === 'in_progress' && from === 'review') return 'Вернуть на доработку';
  if (to === 'paid') return role === 'customer' ? 'Подтвердить оплату' : 'Запросить оплату';
  if (to === 'cancelled') return 'Отменить';
  return to;
}
