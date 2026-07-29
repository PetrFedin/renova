/** События счёта для timeline в PaymentDetailSheet */
import type { Payment, PaymentEvent } from '@/lib/api';
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

const EVIDENCE_LABEL: Record<string, string> = {
  receipt: 'Подтверждение: чек',
  bank_statement: 'Подтверждение: банковская выписка',
  yookassa: 'Подтверждение: ЮKassa',
  transfer_ack: 'Без чека: отметка о переводе',
  yookassa_cancellation: 'Основание: отмена ЮKassa',
  yookassa_refund: 'Основание: возврат ЮKassa',
  customer_dispute: 'Основание: заявление заказчика',
  customer_dispute_resolution: 'Основание: отзыв спора заказчиком',
};

function canonicalTitle(event: PaymentEvent): string {
  if (event.evidence_type === 'customer_dispute_resolution') {
    return event.new_status === 'confirmed'
      ? 'Спор отозван — оплата подтверждена'
      : 'Спор отозван — перевод без проверки';
  }
  if (event.evidence_type === 'customer_dispute') return 'Оплата оспорена';
  if (event.new_status === 'confirmed') {
    if (event.evidence_type === 'bank_statement') return 'Оплата подтверждена по выписке';
    if (event.evidence_type === 'yookassa') return 'Оплата подтверждена через ЮKassa';
    if (event.evidence_type === 'receipt') return 'Оплата подтверждена по чеку';
    return 'Оплата подтверждена';
  }
  if (event.new_status === 'paid_unverified') return 'Перевод отмечен без проверки';
  if (event.new_status === 'disputed') return 'Оплата оспорена';
  if (event.new_status === 'refunded') return 'Оплата возвращена';
  if (event.new_status === 'cancelled') return 'Оплата отменена';
  return PAYMENT_STATUS_LABEL[event.new_status] || `Статус: ${event.new_status}`;
}

function canonicalSubtitle(event: PaymentEvent): string | undefined {
  const parts: string[] = [];
  if (event.actor_label) parts.push(event.actor_label);
  if (event.evidence_type && EVIDENCE_LABEL[event.evidence_type]) {
    parts.push(EVIDENCE_LABEL[event.evidence_type]);
  }
  if (event.note) parts.push(event.note);
  return parts.length ? parts.join(' · ') : undefined;
}

function canonicalEvents(events: PaymentEvent[]): PaymentHistoryEvent[] {
  return events.map((event) => ({
    id: event.id,
    at: event.created_at,
    title: canonicalTitle(event),
    subtitle: canonicalSubtitle(event),
  }));
}

/** Хронология использует канонические PaymentEvent; старые записи имеют безопасный fallback. */
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

  if (payment.events?.length) {
    events.push(...canonicalEvents(payment.events));
    return events.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
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
