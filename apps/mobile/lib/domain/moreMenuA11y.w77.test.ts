/**
 * W77: бейдж «Ещё» = задачи, не чат.
 * Run: npx tsx apps/mobile/lib/domain/moreMenuA11y.w77.test.ts
 */
import { moreMenuA11yLabel } from './moreMenuA11y';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(moreMenuA11yLabel(0, 0) === 'Ещё', 'empty');
assert(moreMenuA11yLabel(4, 0) === 'Ещё, 4 задачи во входящих', 'tasks only');
assert(moreMenuA11yLabel(1, 0) === 'Ещё, 1 задача во входящих', 'one task');
assert(moreMenuA11yLabel(2, 0) === 'Ещё, 2 задачи во входящих', 'two tasks');
assert(moreMenuA11yLabel(22, 0) === 'Ещё, 22 задачи во входящих', '22 tasks');
assert(moreMenuA11yLabel(11, 0) === 'Ещё, 11 задач во входящих', '11 tasks');
assert(
  moreMenuA11yLabel(4, 2) === 'Ещё, 4 задачи во входящих, 2 непрочитанных в сообщениях',
  'tasks + chat hint in a11y',
);
assert(moreMenuA11yLabel(0, 3) === 'Ещё, 3 непрочитанных в сообщениях', 'chat-only a11y');
assert(moreMenuA11yLabel(0, 21) === 'Ещё, 21 непрочитанное в сообщениях', '21 unread a11y');
assert(moreMenuA11yLabel(5, 0) === 'Ещё, 5 задач во входящих', '5 tasks');

console.log('moreMenuA11y.w77.test OK');
