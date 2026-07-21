/**
 * Header badges: More = actions only; messages separate.
 * Run: npx tsx apps/mobile/lib/domain/headerChatBadges.w80.test.ts
 */
import { dockChatBadgeCount, resolveHeaderMoreBadge, resolveInboxMenuBadges } from './headerChatBadges';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(resolveHeaderMoreBadge(4, 0)?.kind === 'tasks', 'tasks when no chat');
assert(resolveHeaderMoreBadge(4, 0)?.count === 4, 'task count');
assert(resolveHeaderMoreBadge(4, 3)?.kind === 'tasks', 'tasks stay on More even with chat');
assert(resolveHeaderMoreBadge(4, 3)?.count === 4, 'More shows tasks not chat');
assert(resolveHeaderMoreBadge(4, 3)?.tone === 'warning', 'tasks tone');
assert(resolveHeaderMoreBadge(0, 5) === null, 'More empty when no tasks despite chat');
assert(dockChatBadgeCount(3) === 3, 'dock chat independent');
assert(resolveInboxMenuBadges(2, 7).chat === 7 && resolveInboxMenuBadges(2, 7).tasks === 2, 'menu separate');

console.log('headerChatBadges.w80.test OK');
