/**
 * W77: бейдж «Ещё» = только задачи; сообщения не озвучиваются на «Ещё».
 * Run: npx tsx apps/mobile/lib/domain/moreMenuA11y.w77.test.ts
 */
import { moreMenuA11yLabel, chatMessagesA11yLabel, calendarDockA11yLabel } from './moreMenuA11y';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(moreMenuA11yLabel(0, 0) === 'Ещё', 'empty');
assert(moreMenuA11yLabel(1, 0) === 'Ещё, 1 задача требует внимания', 'one task');
assert(moreMenuA11yLabel(4, 0) === 'Ещё, 4 задачи требуют внимания', 'few tasks');
assert(moreMenuA11yLabel(5, 0) === 'Ещё, 5 задач требуют внимания', 'many tasks');
assert(moreMenuA11yLabel(4, 2) === 'Ещё, 4 задачи требуют внимания', 'tasks even with chat');
assert(moreMenuA11yLabel(0, 3) === 'Ещё', 'no chat on More when tasks empty');
assert(chatMessagesA11yLabel(5) === 'Сообщения, 5 непрочитанных', 'messages a11y');
assert(calendarDockA11yLabel(3) === 'Календарь, 3 задачи на сегодня', 'calendar a11y');

console.log('moreMenuA11y.w77.test OK');
