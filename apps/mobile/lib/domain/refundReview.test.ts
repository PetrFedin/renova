import assert from 'node:assert/strict';
import { makeDecisionKey, refundActions, refundErrorMessage } from './refundReview';

const open = { effective_review_status: 'open', review_owner_id: null, review_version: 0 };
const mine = { effective_review_status: 'claimed', review_owner_id: 'a1', review_version: 1 };
const resolved = { effective_review_status: 'resolved', review_owner_id: null, review_version: 2 };

// не взят: можно только взять в работу
let a = refundActions(open, 'a1');
assert.equal(a.canClaim, true);
assert.equal(a.canLink, false);
assert.equal(a.canDismiss, false);

// взял сам: закрыть без последствий и отпустить можно, привязать нельзя — с причиной
a = refundActions(mine, 'a1');
assert.equal(a.canClaim, false);
assert.equal(a.canRelease, true);
assert.equal(a.canDismiss, true);
assert.equal(a.canLink, false);
assert.match(a.linkBlockedReason ?? '', /другой администратор/);

// взял другой админ: привязку утвердить может второй, закрыть без последствий — нет
a = refundActions(mine, 'a2');
assert.equal(a.canLink, true);
assert.equal(a.canDismiss, false);
assert.equal(a.canRelease, false);
assert.equal(a.canClaim, false);

// закрытый случай — действий нет
a = refundActions(resolved, 'a1');
assert.deepEqual([a.canClaim, a.canRelease, a.canDismiss, a.canLink], [false, false, false, false]);

assert.ok(makeDecisionKey('0123456789abcdef', 'dismiss_duplicate', 1700000000000).length >= 8);
assert.ok(makeDecisionKey('x'.repeat(40), 'link_and_apply', 1).length <= 80);
assert.match(refundErrorMessage('refund_review_second_admin_required', 'x'), /другой администратор/);
assert.equal(refundErrorMessage('unknown', 'fb'), 'fb');

console.log('refundReview.test OK');
