import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { buildPaymentHistory } from './domain/paymentHistory';
import type { Payment } from './api';

const payment: Payment = {
  id: 'payment-history-test',
  title: 'Оплата чистовой отделки',
  amount: 15000,
  payment_type: 'stage',
  status: 'refunded',
  stage_id: null,
  notes: null,
  confirmed_at: '2026-07-29T12:02:00',
  created_at: '2026-07-29T12:00:00',
  receipt_id: 'receipt-history-test',
  events: [
    {
      id: 'event-confirmed',
      old_status: 'pending',
      new_status: 'confirmed',
      source: 'manual',
      evidence_type: 'receipt',
      note: null,
      actor_label: 'Заказчик',
      created_at: '2026-07-29T12:02:00',
    },
    {
      id: 'event-disputed',
      old_status: 'confirmed',
      new_status: 'disputed',
      source: 'manual',
      evidence_type: 'customer_dispute',
      note: 'Обнаружены существенные недостатки выполненных работ',
      actor_label: 'Заказчик',
      created_at: '2026-07-29T12:03:00',
    },
    {
      id: 'event-refunded',
      old_status: 'disputed',
      new_status: 'refunded',
      source: 'webhook',
      evidence_type: 'yookassa_refund',
      note: null,
      actor_label: 'ЮKassa',
      created_at: '2026-07-29T12:04:00',
    },
  ],
};

const timeline = buildPaymentHistory(payment);
assert.deepEqual(
  timeline.map((event) => event.title),
  [
    'Счёт выставлен',
    'Оплата подтверждена по чеку',
    'Оплата оспорена',
    'Оплата возвращена',
  ],
);
assert.match(timeline[1].subtitle || '', /Заказчик.*Подтверждение: чек/);
assert.match(timeline[2].subtitle || '', /существенные недостатки/);
assert.match(timeline[3].subtitle || '', /ЮKassa.*возврат ЮKassa/);
assert.ok(!timeline.some((event) => (event.subtitle || '').includes('refund.succeeded')));

const legacy: Payment = {
  id: 'legacy-payment',
  title: 'Старый счёт',
  amount: 1000,
  payment_type: 'advance',
  status: 'confirmed',
  stage_id: null,
  notes: null,
  confirmed_at: '2026-07-20T10:00:00',
  created_at: '2026-07-19T10:00:00',
};
assert.deepEqual(
  buildPaymentHistory(legacy).map((event) => event.title),
  ['Счёт выставлен', 'Оплата подтверждена'],
  'Legacy payments without events must retain a safe fallback timeline',
);

const root = process.cwd();
const service = fs.readFileSync(path.join(root, 'backend/app/services/payment_history_service.py'), 'utf8');
const route = fs.readFileSync(path.join(root, 'backend/app/api/v1/payment_history.py'), 'utf8');
const router = fs.readFileSync(path.join(root, 'backend/app/api/v1/router.py'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'backend/app/schemas/project.py'), 'utf8');
const typeSource = fs.readFileSync(path.join(root, 'apps/mobile/lib/api/types/budget.ts'), 'utf8');
const historySource = fs.readFileSync(path.join(root, 'apps/mobile/lib/domain/paymentHistory.ts'), 'utf8');

assert.match(service, /PaymentEvent\.payment_id\.in_\(payment_ids\)/, 'Events must be loaded in one bulk query');
assert.match(service, /Receipt\.payment_id\.in_\(payment_ids\)/, 'Receipt links must be loaded in one bulk query');
assert.match(service, /_SAFE_NOTE_EVIDENCE/, 'Technical notes must be filtered server-side');
assert.doesNotMatch(service, /"evidence_ref":/, 'Raw provider evidence references must not leave the server projection');
assert.match(route, /events=event_map\.get\(payment\.id, \[\]\)/, 'Canonical payment list must embed event history');
assert.ok(router.indexOf('payment_history.router') < router.indexOf('payments.router'), 'History route must precede the legacy list route');
assert.match(schema, /events: list\[PaymentEventOut\] = Field\(default_factory=list\)/, 'API schema must provide a safe empty history');
assert.match(typeSource, /events\?: PaymentEvent\[\]/, 'Mobile Payment type must expose canonical events');
assert.doesNotMatch(historySource, /без отдельного API/, 'Synthetic-only history must not return');

console.log('Payment event history integrity contract passed');
