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
assert(resolveHeaderMoreBadge(4, 3)?.kind === 'chat', 'chat wins over tasks');
assert(resolveHeaderMoreBadge(4, 3)?.count === 3, 'chat count on header');
assert(resolveHeaderMoreBadge(4, 3)?.tone === 'danger', 'chat tone');
assert(dockChatBadgeCount(3) === 3, 'dock same as header chat');
assert(dockChatBadgeCount(0) === 0, 'dock empty');
assert(resolveHeaderMoreBadge(0, 0) === null, 'empty');

for (const n of [1, 5, 12]) {
  const h = resolveHeaderMoreBadge(99, n);
  assert(h!.count === dockChatBadgeCount(n), `sync header/dock ${n}`);
  const row = resolveInboxMenuBadges(99, n);
  assert(row.chat === dockChatBadgeCount(n), `sync inbox-row/dock ${n}`);
  assert(row.tasks === 99, `tasks preserved ${n}`);
}

assert(resolveInboxMenuBadges(2, 0).chat === 0, 'no chat badge when zero');
assert(resolveInboxMenuBadges(2, 0).tasks === 2, 'tasks only');

console.log('headerChatBadges.w80.test OK');
