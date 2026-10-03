/**
 * BUD-19: чек без проверки ФНС по-прежнему подтверждает счёт (сценарий оплаты не менялся),
 * но такой платёж везде подписывается «без проверки ФНС».
 */
import { NO_FNS_CHECK_LABEL } from './expenseAnalytics';

export function paymentCheckLabel(payment: { status: string; receipt_unverified?: boolean | null }): string | null {
  if (payment.receipt_unverified && payment.status === 'confirmed') return NO_FNS_CHECK_LABEL;
  return null;
}
