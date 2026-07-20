/**
 * W80 header/dock chat badge sync.
 * Run: npx tsx apps/mobile/lib/domain/headerChatBadges.w80.test.ts
 */
import { dockChatBadgeCount, resolveHeaderMoreBadge } from './headerChatBadges';

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

// sync invariant: when chat>0, header count === dock count
for (const n of [1, 5, 12]) {
  const h = resolveHeaderMoreBadge(99, n);
  assert(h!.count === dockChatBadgeCount(n), `sync ${n}`);
}

console.log('headerChatBadges.w80.test OK');
