/**
 * W77: бейдж и accessibility кнопки «Ещё» относятся только к задачам.
 * Непрочитанные сообщения показываются только в dock «Сообщения» и строке «Входящие».
 * Run: npx tsx apps/mobile/lib/domain/moreMenuA11y.w77.test.ts
 */
import { moreMenuA11yLabel } from './moreMenuA11y';
import {
  dockChatBadgeCount,
  resolveHeaderMoreBadge,
  resolveInboxMenuBadges,
} from './headerChatBadges';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(moreMenuA11yLabel(0, 0) === 'Ещё', 'empty');
assert(moreMenuA11yLabel(4, 0) === 'Ещё, 4 задачи во входящих', 'tasks only');
assert(moreMenuA11yLabel(1, 0) === 'Ещё, 1 задача во входящих', 'one task');
assert(moreMenuA11yLabel(2, 0) === 'Ещё, 2 задачи во входящих', 'two tasks');
assert(moreMenuA11yLabel(22, 0) === 'Ещё, 22 задачи во входящих', '22 tasks');
assert(moreMenuA11yLabel(11, 0) === 'Ещё, 11 задач во входящих', '11 tasks');
assert(moreMenuA11yLabel(4, 2) === 'Ещё, 4 задачи во входящих', 'chat must not leak into More a11y');
assert(moreMenuA11yLabel(0, 3) === 'Ещё', 'chat-only must not decorate More');
assert(moreMenuA11yLabel(0, 21) === 'Ещё', 'large chat-only must not decorate More');
assert(moreMenuA11yLabel(5, 0) === 'Ещё, 5 задач во входящих', '5 tasks');

const noMoreBadge = resolveHeaderMoreBadge(0, 8);
assert(noMoreBadge === null, 'More badge must stay empty when there are only unread messages');

const moreBadge = resolveHeaderMoreBadge(6, 8);
assert(moreBadge?.count === 6, 'More badge count must be tasks only');
assert(moreBadge?.kind === 'tasks', 'More badge kind must remain tasks');
assert(moreBadge?.tone === 'warning', 'More badge tone must remain warning');

assert(dockChatBadgeCount(8) === 8, 'dock chat badge must use unread messages');
assert(dockChatBadgeCount(-4) === 0, 'dock chat badge must clamp negative values');

const inbox = resolveInboxMenuBadges(6, 8);
assert(inbox.tasks === 6, 'Inbox tasks counter must remain independent');
assert(inbox.chat === 8, 'Inbox chat counter must remain independent');

console.log('moreMenuA11y.w77.test OK');
