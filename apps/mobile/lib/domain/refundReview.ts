/**
 * Что админ может сделать с возвратом подписки (MKT-033). Отражает правила сервера:
 * claim — аренда случая; закрытие без последствий делает владелец claim, а привязка
 * возврата к покупке (link_and_apply) утверждается ДРУГИМ администратором.
 */
export type RefundReviewLike = {
  effective_review_status: string;
  review_owner_id: string | null;
  review_version: number;
};

export type RefundActions = {
  canClaim: boolean;
  canRelease: boolean;
  canDismiss: boolean;
  canLink: boolean;
  /** Почему привязка недоступна — показывается админу вместо кнопки. */
  linkBlockedReason: string | null;
};

export function refundActions(item: RefundReviewLike, adminId: string | undefined): RefundActions {
  const claimed = item.effective_review_status === 'claimed';
  const mine = claimed && !!adminId && item.review_owner_id === adminId;
  const byOther = claimed && !mine;
  const resolved = item.effective_review_status === 'resolved';
  let linkBlockedReason: string | null = null;
  if (resolved) linkBlockedReason = null;
  else if (!claimed) linkBlockedReason = 'Сначала возьмите случай в работу — привязку затем подтвердит другой администратор.';
  else if (mine) linkBlockedReason = 'Привязку подтверждает другой администратор: вы взяли этот случай в работу.';
  return {
    canClaim: !claimed && !resolved,
    canRelease: mine,
    canDismiss: mine,
    canLink: byOther,
    linkBlockedReason,
  };
}

/** Ключ идемпотентности решения: одно нажатие — один ключ, повтор того же решения безопасен. */
export function makeDecisionKey(refundId: string, action: string, nowMs: number): string {
  return `${action}-${refundId.slice(0, 8)}-${nowMs.toString(36)}`.slice(0, 80);
}

export function refundErrorMessage(code: string | undefined, fallback: string): string {
  switch (code) {
    case 'refund_review_second_admin_required':
      return 'Привязку возврата должен подтвердить другой администратор, не тот, кто взял случай в работу.';
    case 'refund_review_active_claim_required':
      return 'Нет активного захвата. Возьмите случай в работу и повторите.';
    case 'refund_review_claimed_by_other':
      return 'Случай уже взят другим администратором.';
    case 'refund_review_version_conflict':
      return 'Случай изменился. Обновите список и повторите.';
    case 'refund_review_already_resolved':
      return 'Случай уже закрыт.';
    case 'refund_review_exceeds_purchase':
      return 'Сумма возврата больше суммы покупки.';
    case 'refund_review_note_invalid':
      return 'Комментарий должен быть не короче 10 символов.';
    default:
      return fallback;
  }
}
