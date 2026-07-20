/**
 * W77: бейдж «Ещё» = задачи, не чат.
 * Run: npx tsx apps/mobile/lib/domain/moreMenuA11y.w77.test.ts
 */
import { moreMenuA11yLabel } from './moreMenuA11y';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(moreMenuA11yLabel(0, 0) === 'Ещё', 'empty');
assert(moreMenuA11yLabel(4, 0) === 'Ещё, 4 задач во входящих', 'tasks only');
assert(moreMenuA11yLabel(1, 0) === 'Ещё, 1 задача во входящих', 'one task');
assert(
  moreMenuA11yLabel(4, 2) === 'Ещё, 4 задач во входящих, 2 непрочитанных в сообщениях',
  'tasks + chat hint in a11y',
);
assert(moreMenuA11yLabel(0, 3) === 'Ещё, 3 непрочитанных в сообщениях', 'chat-only a11y');

console.log('moreMenuA11y.w77.test OK');
