/**
 * W77: «Ещё» a11y = задачи, не чат.
 * Run: npx tsx apps/mobile/lib/domain/moreMenuA11y.w77.test.ts
 */
import { moreMenuA11yLabel } from './moreMenuA11y';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(moreMenuA11yLabel(0, 0) === 'Ещё', 'empty');
assert(moreMenuA11yLabel(1, 0) === 'Ещё, 1 задача требует внимания', 'one');
assert(moreMenuA11yLabel(4, 2) === 'Ещё, 4 задачи требуют внимания', 'ignores chat');
assert(moreMenuA11yLabel(0, 3) === 'Ещё', 'no chat on More');

console.log('moreMenuA11y.w77.test OK');
