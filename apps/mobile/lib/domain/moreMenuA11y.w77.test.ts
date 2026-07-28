/**
 * W77: a11y шапки «Меню» — только задачи; чат озвучивает dock.
 * Run: npx tsx apps/mobile/lib/domain/moreMenuA11y.w77.test.ts
 */
import { moreMenuA11yLabel } from './moreMenuA11y';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(moreMenuA11yLabel(0, 0) === 'Меню', 'empty');
assert(moreMenuA11yLabel(4, 0) === 'Меню, 4 задач во входящих', 'tasks only');
assert(moreMenuA11yLabel(1, 0) === 'Меню, 1 задача во входящих', 'one task');
assert(moreMenuA11yLabel(4, 2) === 'Меню, 4 задач во входящих', 'tasks when chat also present');
assert(moreMenuA11yLabel(0, 3) === 'Меню', 'chat-only → plain Меню (dock owns chat a11y)');

console.log('moreMenuA11y.w77.test OK');
