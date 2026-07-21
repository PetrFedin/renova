/**
 * Header/dock/inbox: устойчивая семантика (без подмены chat→tasks на «Ещё»).
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
assert(dockChatBadgeCount(0) === 0, 'dock empty');
assert(resolveHeaderMoreBadge(0, 0) === null, 'empty');

for (const n of [1, 5, 12]) {
  const h = resolveHeaderMoreBadge(99, n);
  assert(h!.count === 99, `More stays tasks while chat=${n}`);
  assert(dockChatBadgeCount(n) === n, `dock chat ${n}`);
  const row = resolveInboxMenuBadges(99, n);
  assert(row.chat === n, `inbox-row chat ${n}`);
  assert(row.tasks === 99, `tasks preserved ${n}`);
}

assert(resolveInboxMenuBadges(2, 0).chat === 0, 'no chat badge when zero');
assert(resolveInboxMenuBadges(2, 0).tasks === 2, 'tasks only');

console.log('headerChatBadges.w80.test OK');
