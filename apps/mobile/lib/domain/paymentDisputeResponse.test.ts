import {
  canRespondToDispute,
  latestDisputeResponse,
  validateDisputeResponseComment,
} from './paymentDisputeResponse';
import { buildPaymentHistory } from './paymentHistory';

let ok = true;
function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('FAIL', msg); ok = false; }
}

assert(canRespondToDispute({ role: 'contractor', status: 'disputed' }), 'lead contractor responds');
assert(canRespondToDispute({ role: 'contractor', teamRole: 'owner', status: 'disputed' }), 'owner responds');
assert(!canRespondToDispute({ role: 'contractor', teamRole: 'foreman', status: 'disputed' }), 'foreman cannot respond');
assert(!canRespondToDispute({ role: 'customer', status: 'disputed' }), 'customer cannot respond');
assert(!canRespondToDispute({ role: 'contractor', status: 'confirmed' }), 'only disputed');
assert(!canRespondToDispute({ role: 'contractor', status: 'disputed', readOnly: true }), 'read-only');

const dispute = { id: 'e1', evidence_type: 'customer_dispute', note: 'не те работы', created_at: '2026-10-01T10:00:00Z' };
const agree = { id: 'e2', evidence_type: 'contractor_dispute_agree', note: 'вернём деньги', created_at: '2026-10-01T11:00:00Z' };
const contest = { id: 'e3', evidence_type: 'contractor_dispute_contest', note: 'работы сданы', created_at: '2026-10-01T12:00:00Z' };

assert(latestDisputeResponse([dispute]) === null, 'no response yet');
assert(latestDisputeResponse(undefined) === null, 'no events');
assert(latestDisputeResponse([dispute, agree])?.kind === 'agree', 'agree');
assert(latestDisputeResponse([dispute, agree, contest])?.kind === 'contest', 'latest response wins');
assert(latestDisputeResponse([dispute, agree, { ...dispute, id: 'e4', created_at: '2026-10-01T13:00:00Z' }]) === null, 'response to an older dispute is not shown');
assert(latestDisputeResponse([contest, agree, dispute].reverse())?.kind === 'contest', 'order of array is irrelevant');

assert(!validateDisputeResponseComment('коротко').ok, 'short comment rejected');
const valid = validateDisputeResponseComment('  работы   сданы по акту ');
assert(valid.ok && valid.text === 'работы сданы по акту', 'comment normalized');

const history = buildPaymentHistory({
  id: 'p', title: 'Этап', amount: 1, payment_type: 'stage', status: 'disputed', stage_id: null, notes: null,
  confirmed_at: null, created_at: '2026-10-01T09:00:00Z',
  events: [
    { ...dispute, old_status: 'confirmed', new_status: 'disputed', source: 'manual', actor_label: 'Заказчик' },
    { ...agree, old_status: 'disputed', new_status: 'disputed', source: 'manual', actor_label: 'Исполнитель' },
  ],
});
assert(history.some((e) => e.id === 'e2' && e.title === 'Исполнитель согласен вернуть оплату'), 'response is titled in history');

if (!ok) process.exit(1);
console.log('paymentDisputeResponse tests passed');
