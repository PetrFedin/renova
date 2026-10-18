import { buildPaymentHistory } from './paymentHistory';
import { paymentRefundPresentation, formatPaymentMoney } from './paymentRefundPresentation';

const base = {
  id: 'p1',
  title: 'Этап 1',
  amount: 10000,
  payment_type: 'stage',
  stage_id: null,
  notes: null,
  confirmed_at: null,
  created_at: '2026-01-10T12:00:00Z',
};

let ok = true;
function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('FAIL', msg); ok = false; }
}

const pending = buildPaymentHistory({ ...base, status: 'pending' });
assert(pending.some((e) => e.id === 'created'), 'created event');
assert(pending.some((e) => e.id === 'pending'), 'pending event');

const confirmed = buildPaymentHistory({
  ...base,
  status: 'confirmed',
  confirmed_at: '2026-01-12T15:00:00Z',
});
assert(confirmed.some((e) => e.id === 'confirmed'), 'confirmed event');
assert(confirmed[confirmed.length - 1].id === 'confirmed', 'confirmed last');

const partial = buildPaymentHistory({
  ...base,
  status: 'confirmed',
  events: [{
    id: 'ref-p',
    old_status: 'confirmed',
    new_status: 'confirmed',
    source: 'webhook',
    evidence_type: 'yookassa_refund_partial',
    actor_label: 'ЮKassa',
    created_at: '2026-10-18T14:00:00Z',
    refund_amount: 1000,
  }],
});
const item = partial.find((e) => e.id === 'ref-p');
assert(Boolean(item), 'partial refund must be in canonical timeline');
assert(item?.title === 'Частичный возврат ЮKassa', 'same-status partial refund has distinct title');
assert((item?.subtitle ?? '').includes('1 000') || (item?.subtitle ?? '').includes('1 000'),
  'partial refund shows exact returned amount');
assert((item?.subtitle ?? '').includes('ЮKassa'), 'webhook attribution preserved');

const fullRefund = buildPaymentHistory({
  ...base,
  status: 'refunded',
  events: [{
    id: 'ref-f',
    old_status: 'confirmed',
    new_status: 'refunded',
    source: 'webhook',
    evidence_type: 'yookassa_refund',
    actor_label: 'ЮKassa',
    created_at: '2026-10-18T14:00:00Z',
    refund_amount: 2500,
  }],
});
assert(fullRefund.some((e) => e.id === 'ref-f' && e.title === 'Возврат ЮKassa'),
  'full-refund event must not be confused with partial refund');

const refund = paymentRefundPresentation({
  amount: 5000,
  status: 'confirmed',
  refunded_amount: 1000.01,
  net_amount: 3999.99,
});
assert(refund?.kind === 'partial', 'valid partial refund should be a partial state');
assert(refund?.kind === 'partial' && refund.returned === formatPaymentMoney(1000.01),
  'refund amount must preserve exact kopecks');
assert(refund?.kind === 'partial' && refund.remaining === formatPaymentMoney(3999.99),
  'remaining amount must preserve exact kopecks');
assert(paymentRefundPresentation({
  amount: 5000, status: 'refunded', refunded_amount: 5000, net_amount: 0,
})?.kind === 'full', 'exact full refund state');
assert(paymentRefundPresentation({
  amount: 5000, status: 'confirmed', refunded_amount: 1000, net_amount: 5000,
})?.kind === 'inconsistent', 'mismatched project ledger cannot be silently shown as paid');
assert(paymentRefundPresentation({
  amount: 5000, status: 'confirmed', refunded_amount: 1000, net_amount: null,
})?.kind === 'inconsistent', 'missing server net must not be guessed');
assert(paymentRefundPresentation({
  amount: 5000, status: 'refunded', refunded_amount: 1000, net_amount: 4000,
})?.kind === 'inconsistent', 'refunded terminal state cannot have remaining charge');

if (!ok) process.exit(1);
console.log('paymentHistory.test OK');
