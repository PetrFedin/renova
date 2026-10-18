/** Human-readable project refund truth; never guess missing/mismatched net money. */
import type { Payment } from '@/lib/api';

export type PaymentRefundPresentation =
  | { kind: 'partial' | 'full'; returned: string; remaining: string }
  | { kind: 'inconsistent'; reason: string };

const formatter = new Intl.NumberFormat('ru-RU', {
  style: 'currency', currency: 'RUB',
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

export function formatPaymentMoney(value: number): string {
  return formatter.format(value);
}

function cents(value: number): number | null {
  if (!Number.isFinite(value) || value < 0) return null;
  const scaled = value * 100;
  if (Math.abs(scaled - Math.round(scaled)) > 0.00001) return null;
  return Math.round(scaled);
}

export function paymentRefundPresentation(
  payment: Pick<Payment, 'amount' | 'status' | 'refunded_amount' | 'net_amount'>,
): PaymentRefundPresentation | null {
  if (payment.refunded_amount == null || payment.refunded_amount === 0) {
    return payment.status === 'refunded'
      ? { kind: 'inconsistent', reason: 'Оплата отмечена возвращённой без финансовой записи о возврате. Нужна сверка.' }
      : null;
  }

  const gross = cents(payment.amount);
  const refunded = cents(payment.refunded_amount);
  const net = payment.net_amount == null ? null : cents(payment.net_amount);

  if (gross === null || refunded === null || net === null
    || refunded <= 0 || refunded > gross || gross - refunded !== net) {
    return {
      kind: 'inconsistent',
      reason: 'Суммы возврата и остатка не удалось сверить с сервером. Проверьте историю платежа.',
    };
  }
  if ((payment.status === 'refunded') !== (net === 0)) {
    return {
      kind: 'inconsistent',
      reason: 'Статус возврата и остаток платежа не совпадают. Нужна сверка.',
    };
  }

  return {
    kind: net === 0 ? 'full' : 'partial',
    returned: formatPaymentMoney(payment.refunded_amount),
    remaining: formatPaymentMoney(payment.net_amount as number),
  };
}
