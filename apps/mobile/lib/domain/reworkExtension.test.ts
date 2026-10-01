import {
  extensionExceedsLimit,
  pendingReworkExtension,
  reworkExtensionView,
} from './reworkExtension';

let ok = true;
function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('FAIL', msg); ok = false; }
}

const rework = { status: 'active', needs_rework: true, rework_deadline: '2026-10-05T00:00:00Z' };
const request = { text: 'Запрос продления срока доработки на 1 дн. — до 2026-10-06', author_role: 'contractor', created_at: '2026-10-04T10:00:00Z' };
const extended = { text: 'Срок доработки продлён на 1 дн. — до 2026-10-06', author_role: 'customer', created_at: '2026-10-04T11:00:00Z' };
const declined = { text: 'Продление срока доработки отклонено: нет', author_role: 'customer', created_at: '2026-10-04T11:00:00Z' };

assert(pendingReworkExtension(rework, [request])?.days === 1, 'request pending');
assert(pendingReworkExtension(rework, [request])?.requestedDeadline === '2026-10-06', 'requested date parsed');
assert(pendingReworkExtension(rework, []) === null, 'no comments → none');
assert(pendingReworkExtension(rework, undefined) === null, 'undefined comments → none');
assert(pendingReworkExtension(rework, [request, declined]) === null, 'declined closes request');
assert(pendingReworkExtension(rework, [request, extended]) === null, 'extended closes request');
assert(pendingReworkExtension(rework, [request, declined, { ...request, text: 'Запрос продления срока доработки на 2 дн. — до 2026-10-07' }])?.days === 2, 'new request after decline is pending');
assert(pendingReworkExtension({ ...rework, rework_deadline: '2026-10-06T00:00:00Z' }, [request]) === null, 'deadline already reached → none');
assert(pendingReworkExtension({ ...rework, needs_rework: false }, [request]) === null, 'no rework → none');
assert(pendingReworkExtension({ ...rework, status: 'review' }, [request]) === null, 'not active → none');
assert(pendingReworkExtension(rework, [{ ...request, author_role: 'customer' }]) === null, 'customer-authored text is not a request');

const req = pendingReworkExtension(rework, [request]);
assert(reworkExtensionView({ isContractor: false, canWrite: true, request: req }) === 'customer_decide', 'customer decides');
assert(reworkExtensionView({ isContractor: false, canWrite: false, request: req }) === null, 'read-only customer sees no buttons');
assert(reworkExtensionView({ isContractor: true, canWrite: true, request: req }) === 'contractor_waiting', 'contractor waits');
assert(reworkExtensionView({ isContractor: false, canWrite: true, request: null }) === null, 'nothing to show');

const now = new Date('2026-10-01T00:00:00Z');
assert(!extensionExceedsLimit('2026-10-05T00:00:00Z', 1, now), 'within limit');
assert(extensionExceedsLimit('2026-10-15T00:00:00Z', 1, now), 'over 14 days ahead');
assert(!extensionExceedsLimit('2026-09-20T00:00:00Z', 1, now), 'past deadline counts from now');

if (!ok) process.exit(1);
console.log('reworkExtension tests passed');
