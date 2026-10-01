/**
 * Кто какие действия приёмки видит (STG-004 / UI-010). Чистая функция — единый источник
 * для карточки этапа, вкладки «Приёмка» и деталей работ.
 *
 * Цикл: сдать (active → review) → принять (done) | вернуть (review → active + needs_rework)
 *        → доработать → сдать повторно.
 */

export type AcceptanceRole = 'customer' | 'contractor';

export type AcceptanceActionsInput = {
  role: AcceptanceRole;
  stageStatus: string;
  needsRework?: boolean;
  /** capabilities.can_submit_for_review; undefined = не знаем → не прячем */
  canSubmit?: boolean;
  /** capabilities.can_review; undefined = не знаем → не прячем */
  canReview?: boolean;
};

export type AcceptanceActions = {
  /** Заказчик: «Принять» и «Вернуть на доработку» */
  canDecide: boolean;
  /** Исполнитель: «На приёмку» (первая сдача) */
  canSubmit: boolean;
  /** Исполнитель: «Сдать повторно» после возврата */
  canResubmit: boolean;
  /** Кнопок нет — только строка статуса */
  statusOnly: boolean;
  /** Что показать вместо кнопок / над ними, по-русски */
  statusText: string | null;
};

export function acceptanceActions(i: AcceptanceActionsInput): AcceptanceActions {
  const rework = i.needsRework === true;
  const none: AcceptanceActions = { canDecide: false, canSubmit: false, canResubmit: false, statusOnly: true, statusText: null };

  if (i.stageStatus === 'review') {
    if (i.role === 'customer') {
      const canDecide = i.canReview !== false;
      return { ...none, canDecide, statusOnly: !canDecide, statusText: canDecide ? 'Ждёт вашего решения' : 'Ждёт приёмки' };
    }
    return { ...none, statusText: 'Ждёт решения заказчика' };
  }
  if (i.stageStatus === 'active') {
    if (i.role === 'contractor') {
      const can = i.canSubmit !== false;
      if (rework) {
        return { ...none, canResubmit: can, statusOnly: !can, statusText: 'Возвращено на доработку' };
      }
      return { ...none, canSubmit: can, statusOnly: !can, statusText: null };
    }
    return { ...none, statusText: rework ? 'Возвращено исполнителю на доработку' : null };
  }
  if (i.stageStatus === 'done') return { ...none, statusText: 'Принято' };
  return none;
}

/** Статус этапа для подписи: «доработка» — флаг поверх active, не отдельный статус. */
export function stageStatusText(stage: { status: string; needs_rework?: boolean }, labels: Record<string, string>): string {
  if (stage.status === 'active' && stage.needs_rework) return 'Возвращён на доработку';
  return labels[stage.status] || stage.status;
}

export const ACCEPTANCE_STATUS_LABEL: Record<string, string> = {
  not_requested: 'Не запрошена',
  requested: 'Ждёт приёмки',
  in_review: 'На проверке у заказчика',
  accepted: 'Принято',
  accepted_with_remarks: 'Принято с замечаниями',
  returned: 'Возвращено на доработку',
  rejected: 'Отклонено',
};

export function acceptanceStatusLabel(status: string | null | undefined): string {
  if (!status) return '—';
  return ACCEPTANCE_STATUS_LABEL[status] || status;
}

type AcceptanceLike = { stage_id: string; status: string; comment: string | null; created_at: string | null };

/** Последняя запись «возвращено» по этапу — там причина возврата. */
export function latestReturnedAcceptance<T extends AcceptanceLike>(acceptances: T[], stageId: string): T | null {
  const rows = acceptances.filter((a) => a.stage_id === stageId && a.status === 'returned');
  if (!rows.length) return null;
  return [...rows].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0];
}

export type ReworkItem = { stageId: string; title: string; reason: string | null; deadline: string | null };

/** Этапы «на доработке» (active + needs_rework) с причиной и сроком — для исполнителя. */
export function buildReworkItems(
  stages: { id: string; name: string; status: string; needs_rework?: boolean; rework_deadline?: string | null }[] | undefined,
  acceptances: AcceptanceLike[],
): ReworkItem[] {
  return (stages || [])
    .filter((s) => s.status === 'active' && s.needs_rework === true)
    .map((s) => ({
      stageId: s.id,
      title: s.name,
      reason: latestReturnedAcceptance(acceptances, s.id)?.comment?.trim() || null,
      deadline: s.rework_deadline ? s.rework_deadline.slice(0, 10) : null,
    }));
}

/** Причина возврата обязательна: пустая/пробельная строка не принимается. */
export function normalizeReturnReason(raw: string | null | undefined): string | null {
  const t = (raw || '').trim();
  return t ? t : null;
}

/**
 * UI-010: роль экрана приёмки берём у пользователя, а не у маршрута/дефолта.
 * Исполнитель никогда не получает интерфейс заказчика, даже если маршрут (или первый
 * рендер до загрузки сессии) подставил customer.
 */
export function effectiveAcceptanceRole(userRole: string | null | undefined, routeRole: AcceptanceRole): AcceptanceRole {
  if (userRole === 'contractor') return 'contractor';
  if (userRole === 'customer') return 'customer';
  return routeRole;
}
