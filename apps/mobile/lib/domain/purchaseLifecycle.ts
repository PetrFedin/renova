/** Жизненный цикл закупки — переходы статусов и подписи кнопок */

export const PURCHASE_NEXT_STATUS: Record<string, string | null> = {
  draft: 'ordered',
  approved: 'ordered',
  ordered: 'paid',
  paid: 'delivered',
};

export function purchaseAdvanceLabel(nextStatus: string): string {
  if (nextStatus === 'ordered') return 'Отметить заказ';
  if (nextStatus === 'paid') return 'Оплачено';
  if (nextStatus === 'delivered') return 'Доставлено';
  if (nextStatus === 'cancelled') return 'Убрать из факта';
  return 'Далее';
}

/**
 * Отменить можно любую незавершённую закупку (зеркало backend `validate_purchase_transition`):
 * ошибочно созданный черновик не должен навсегда держать позиции «в закупке» (REP-25).
 * Для уже оплаченной/доставленной сумма выйдет из факта бюджета.
 */
export function purchaseCancelStatus(current: string): string | null {
  return ['draft', 'approved', 'ordered', 'partial', 'paid', 'delivered'].includes(current) ? 'cancelled' : null;
}

/** Закупка уже влияет на факт бюджета — отмена его пересчитывает. */
export function purchaseCancelAffectsFact(current: string): boolean {
  return current === 'paid' || current === 'partial' || current === 'delivered';
}

export function purchaseCancelLabel(current: string): string {
  return purchaseCancelAffectsFact(current) ? 'Убрать из факта' : 'Отменить закупку';
}

/**
 * Кто вправе отменить (зеркало PURCHASE_TRANSITION_ROLES): заказчик — любую;
 * исполнитель — только ещё не оплаченную. Сервер дополнительно проверяет ведущего/прораба.
 */
export function purchaseRoleMayCancel(role: string | null | undefined, current: string): boolean {
  if (role === 'customer') return true;
  return current === 'draft' || current === 'approved' || current === 'ordered';
}

/**
 * Кто вправе сделать переход (зеркало backend PURCHASE_TRANSITION_ROLES):
 * оплату и откат факта подтверждает заказчик, исполнитель — заказ и доставку.
 */
export function purchaseRoleMayMove(role: string | null | undefined, target: string): boolean {
  if (role === 'customer') return true;
  return target === 'ordered' || target === 'delivered';
}
