/**
 * UI/E2E-сценарий семантики badge (без симулятора):
 * сообщения + задачи → прочитать сообщения → chat badge исчез,
 * задачи НЕ появляются на месте сообщений и НЕ на «Ещё» как «бывшие сообщения».
 *
 * Run: npx tsx apps/mobile/lib/domain/navigationBadges.e2e-scenario.test.ts
 */
import {
  buildNavigationBadges,
  resolveMessagesTabBadge,
  resolveMoreTabBadge,
  resolveCalendarTabBadge,
  type NavigationBadges,
} from './navigationBadges';
import { resolveHeaderMoreBadge } from './headerChatBadges';
import { moreMenuA11yLabel, chatMessagesA11yLabel } from './moreMenuA11y';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

/** Симуляция экрана: открыть приложение с сообщениями и задачами */
function openApp(): NavigationBadges {
  return buildNavigationBadges({
    unreadMessages: 3,
    dueTasks: 2,
    notifications: 2,
  });
}

/** Пользователь прочитал все сообщения */
function readAllMessages(state: NavigationBadges): NavigationBadges {
  return buildNavigationBadges({
    unreadMessages: 0,
    dueTasks: state.dueTasks,
    notifications: state.notifications,
  });
}

const initial = openApp();
assert(resolveMessagesTabBadge(initial)?.count === 3, 'E2E: messages badge 3');
assert(resolveCalendarTabBadge(initial)?.count === 2, 'E2E: calendar tasks 2');
assert(resolveMoreTabBadge(initial)?.count === 2, 'E2E: more notifications 2');
assert(resolveHeaderMoreBadge(2, 3)?.kind === 'tasks', 'E2E: more kind=tasks not chat');
assert(resolveHeaderMoreBadge(2, 3)?.count === 2, 'E2E: more shows 2 not 3');
assert(chatMessagesA11yLabel(3).includes('непрочитанных'), 'E2E: messages a11y');

const afterRead = readAllMessages(initial);
assert(resolveMessagesTabBadge(afterRead) === null, 'E2E: messages badge gone');
assert(resolveMoreTabBadge(afterRead)?.count === 2, 'E2E: tasks stay on More');
assert(resolveMoreTabBadge(afterRead)?.kind === 'notifications', 'E2E: More kind unchanged');
assert(resolveCalendarTabBadge(afterRead)?.count === 2, 'E2E: calendar still tasks');
assert(resolveHeaderMoreBadge(2, 0)?.count === 2, 'E2E: header More still tasks');
assert(moreMenuA11yLabel(2, 0).includes('задач'), 'E2E: more a11y tasks');
assert(!moreMenuA11yLabel(2, 0).includes('непрочитан'), 'E2E: more a11y not chat');

// Критично: число 3 (бывшие сообщения) не «переехало» на More или Calendar
assert(resolveMoreTabBadge(afterRead)?.count !== 3, 'E2E: More ≠ former chat count');
assert(resolveCalendarTabBadge(afterRead)?.count !== 3, 'E2E: Calendar ≠ former chat count');

console.log('navigationBadges.e2e-scenario.test OK');
