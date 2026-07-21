/**
 * W78 offline inbox merge.
 * Run: npx tsx apps/mobile/lib/domain/offlineInbox.w78.test.ts
 */
import { buildOfflineInboxItem, mergeOfflineInboxItem } from './offlineInbox';
import type { InboxItem } from './buildInboxItems';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(buildOfflineInboxItem({ pending: 0 }) === null, 'empty');
const pending = buildOfflineInboxItem({ pending: 2 });
assert(pending?.kind === 'offline', 'pending kind');
assert(/Отправить 2/.test(pending!.title), `title ${pending?.title}`);

const blocked = buildOfflineInboxItem({ pending: 1, blocked: 1 });
assert(/Разобрать/.test(blocked!.title), 'blocked title');
assert(blocked!.priority > pending!.priority, 'blocked higher priority');

const base: InboxItem[] = [
  { id: 'pay-1', kind: 'payment', title: 'Счёт', href: '/b', priority: 85 },
];
const merged = mergeOfflineInboxItem(base, { pending: 3 });
assert(merged.some((i) => i.id === 'offline-queue'), 'merged has offline');
assert(merged[0].id === 'pay-1' || merged.some((i) => i.kind === 'offline'), 'sorted');

console.log('offlineInbox.w78.test OK');
