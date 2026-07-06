import { buildPaymentHistory } from './paymentHistory';

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

if (!ok) process.exit(1);
console.log('paymentHistory.test OK');
