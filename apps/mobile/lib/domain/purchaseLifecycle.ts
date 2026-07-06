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

/** Доставленную закупку можно отменить — pick вернётся в «согласовано», факт пересчитается */
export function purchaseCancelStatus(current: string): string | null {
  return current === 'delivered' ? 'cancelled' : null;
}
