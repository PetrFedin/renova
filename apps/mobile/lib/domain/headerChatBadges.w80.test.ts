/**
 * Header/dock/inbox chat badge sync.
 * Run: npx tsx apps/mobile/lib/domain/headerChatBadges.w80.test.ts
 */
import { dockChatBadgeCount, resolveHeaderMoreBadge, resolveInboxMenuBadges } from './headerChatBadges';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(resolveHeaderMoreBadge(4, 0)?.kind === 'tasks', 'tasks when no chat');
assert(resolveHeaderMoreBadge(4, 0)?.count === 4, 'task count');
// P2: «Ещё» не дублирует dock chat и не XOR — задачи видны даже при unread
assert(resolveHeaderMoreBadge(4, 3)?.kind === 'tasks', 'tasks stay on header when chat>0');
assert(resolveHeaderMoreBadge(4, 3)?.count === 4, 'task count not replaced by chat');
assert(resolveHeaderMoreBadge(4, 3)?.tone === 'warning', 'tasks tone');
assert(resolveHeaderMoreBadge(0, 5) === null, 'no header badge when only chat (dock owns chat)');
assert(dockChatBadgeCount(3) === 3, 'dock chat');
assert(dockChatBadgeCount(0) === 0, 'dock empty');
assert(resolveHeaderMoreBadge(0, 0) === null, 'empty');

for (const n of [1, 5, 12]) {
  assert(dockChatBadgeCount(n) === n, `dock ${n}`);
  const row = resolveInboxMenuBadges(99, n);
  assert(row.chat === dockChatBadgeCount(n), `sync inbox-row/dock ${n}`);
  assert(row.tasks === 99, `tasks preserved ${n}`);
  assert(resolveHeaderMoreBadge(99, n)?.count === 99, `header tasks with chat ${n}`);
}

assert(resolveInboxMenuBadges(2, 0).chat === 0, 'no chat badge when zero');
assert(resolveInboxMenuBadges(2, 0).tasks === 2, 'tasks only');

console.log('headerChatBadges.w80.test OK');
