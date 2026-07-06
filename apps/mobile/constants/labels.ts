/** Единые подписи UI — расходы, платежи, этапы, закупки, согласования */

export const EXPENSE_CATEGORY_LABEL: Record<string, string> = {
  materials: 'Материалы',
  labor: 'Работы',
  works: 'Работы',
  delivery: 'Доставка',
  tools: 'Инструменты',
  other: 'Прочее',
};

export function expenseCategoryLabel(id: string | null | undefined): string {
  if (!id) return 'Материалы';
  return EXPENSE_CATEGORY_LABEL[id] ?? id;
}

export const PAYMENT_TYPE_LABEL: Record<string, string> = {
  advance: 'Аванс',
  stage: 'Этап',
  material: 'Материалы',
  final: 'Финал',
};

export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  pending: 'Ожидает оплаты',
  confirmed: 'Оплачено',
  rejected: 'Отклонено',
};

export const STAGE_DEPENDENCY_TYPE_LABEL: Record<string, string> = {
  stage: 'Этап',
  material: 'Материал',
  workflow: 'Процесс',
};

export const STAGE_STATUS_LABEL: Record<string, string> = {
  done: '✓ Сдан',
  review: '⏳ На приёмке',
  active: '🔨 В работе',
  planned: '○ Запланирован',
};

/** Иконки статуса этапа — компактные таймлайны */
export const STAGE_STATUS_ICON: Record<string, string> = {
  done: '✓',
  review: '⏳',
  active: '🔨',
  planned: '○',
};

/** Статус работы на карточке WorkStageCard */
export const WORK_CARD_STATUS_LABEL: Record<string, string> = {
  done: 'Завершено',
  review: 'Ждёт приёмки',
  active: 'В работе',
  planned: 'Не начато',
  rework: 'Доработка',
};

/** Статьи бюджета — сводка 2×2 */
export const BUDGET_SEGMENT_LABEL: Record<string, string> = {
  works: 'Работы',
  materials: 'Материалы',
  delivery: 'Доставка',
  tools: 'Инструменты',
  other: 'Прочее',
  reserve: 'Резерв',
};

export const PURCHASE_STATUS_LABEL: Record<string, string> = {
  draft: 'Черновик',
  approved: 'Согласовано',
  ordered: 'Заказано',
  paid: 'Оплачено',
  partial: 'Частично',
  delivered: 'Доставлено',
  cancelled: 'Отменено',
  returned: 'Возврат',
};

export const MATERIAL_PICK_STATUS_LABEL: Record<string, string> = {
  draft: 'Черновик',
  pending: 'Ждёт согласования',
  approved: 'Согласовано',
  purchased: 'Куплено',
  rejected: 'Отклонено',
};

export const APPROVAL_TYPE_LABEL: Record<string, string> = {
  material: 'Материал',
  change_order: 'Доп. работы',
  room_change: 'Комната',
  waste: 'Вывоз мусора',
  design: 'Дизайн',
};

export const EXPENSE_ROW_STATUS_LABEL: Record<string, string> = {
  pending_receipt: 'Ждёт чек',
  ok: 'Готово',
};

export const CHANGE_ORDER_STATUS_LABEL: Record<string, string> = {
  pending: 'На согласовании',
  approved: 'Одобрено',
  rejected: 'Отклонено',
};

export const ROOM_CHANGE_STATUS_LABEL: Record<string, string> = {
  pending: 'Ожидает',
  approved: 'Одобрено',
  rejected: 'Отклонено',
};

export function changeOrderStatusLabel(status: string): string {
  return CHANGE_ORDER_STATUS_LABEL[status] ?? status;
}

export function roomChangeStatusLabel(status: string): string {
  return ROOM_CHANGE_STATUS_LABEL[status] ?? status;
}

export function materialPickStatusLabel(status: string): string {
  return MATERIAL_PICK_STATUS_LABEL[status] ?? status;
}

export function workCardStatusLabel(status: string): string {
  return WORK_CARD_STATUS_LABEL[status] ?? status;
}

export const ISSUE_SEVERITY_LABEL: Record<string, string> = {
  low: 'Низкая',
  medium: 'Средняя',
  high: 'Высокая',
  critical: 'Критичная',
};

export const ISSUE_STATUS_LABEL: Record<string, string> = {
  open: 'Открыто',
  in_progress: 'В работе',
  resolved: 'Решено',
  closed: 'Закрыто',
};

export function issueSeverityLabel(severity: string): string {
  return ISSUE_SEVERITY_LABEL[severity] ?? severity;
}

export function issueStatusLabel(status: string): string {
  return ISSUE_STATUS_LABEL[status] ?? status;
}

export const DESIGN_PACKAGE_STATUS_LABEL: Record<string, string> = {
  draft: 'Черновик',
  published: 'Опубликовано',
  pending: 'На согласовании',
  approved: 'Согласовано',
  rejected: 'Отклонено',
};

export function designPackageStatusLabel(status: string): string {
  return DESIGN_PACKAGE_STATUS_LABEL[status] ?? status;
}

export function stageStatusLabel(status: string): string {
  return STAGE_STATUS_LABEL[status]?.replace(/^[✓⏳🔨○]\s*/, '') ?? status;
}

/** Фильтры экрана «Работы» */
export const WORKS_FILTER_LABEL: Record<string, string> = {
  all: 'Активные',
  today: 'Сегодня',
  overdue: 'Просрочено',
  review: 'Приёмка',
  active: 'В работе',
  archive: 'Архив',
  rework: 'Доработка',
  material: 'Ждёт материал',
};

export const PAYMENT_BLOCKED_ACCEPTANCE_MSG =
  'Оплатить можно только после приёмки этапа. Сначала проверьте работы и нажмите «Принять этап».';

export const SETUP_CHECKLIST_LABEL: Record<string, string> = {
  object: 'Объект создан',
  profile: 'Данные объекта',
  rooms: 'Комнаты',
  estimate: 'Смета',
  contractor: 'Исполнитель',
  stages: 'Этапы',
  budget: 'Бюджет под контролем',
};
