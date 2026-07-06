/** События счёта для timeline в PaymentDetailSheet */
import type { Payment } from '@/lib/api';
import { PAYMENT_STATUS_LABEL, PAYMENT_TYPE_LABEL } from '@/constants/labels';

export type PaymentHistoryEvent = {
  id: string;
  at: string;
  title: string;
  subtitle?: string;
};

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Хронология из полей Payment — без отдельного API */
export function buildPaymentHistory(payment: Payment): PaymentHistoryEvent[] {
  const events: PaymentHistoryEvent[] = [];
  const typeLabel = PAYMENT_TYPE_LABEL[payment.payment_type] || payment.payment_type;

  if (payment.created_at) {
    events.push({
      id: 'created',
      at: payment.created_at,
      title: 'Счёт выставлен',
      subtitle: `${typeLabel} · ${payment.title}`,
    });
  }

  if (payment.status === 'rejected') {
    events.push({
      id: 'rejected',
      at: payment.confirmed_at || payment.created_at,
      title: PAYMENT_STATUS_LABEL.rejected,
      subtitle: payment.notes || undefined,
    });
  }

  if (payment.confirmed_at && payment.status === 'confirmed') {
    events.push({
      id: 'confirmed',
      at: payment.confirmed_at,
      title: 'Оплата подтверждена',
      subtitle: payment.notes || undefined,
    });
  } else if (payment.status === 'pending') {
    events.push({
      id: 'pending',
      at: payment.created_at,
      title: 'Ожидает подтверждения',
      subtitle: 'Заказчик ещё не подтвердил оплату',
    });
  }

  return events.sort((a, b) => a.at.localeCompare(b.at));
}

export function formatPaymentEventDate(iso: string) {
  return fmt(iso);
}
