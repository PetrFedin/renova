import { inboxTotal, inboxAttentionBadge, inboxTaskBadge, inboxLinkItems, filterInboxForHero, type InboxItem } from './buildInboxItems';

let ok = true;
function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('FAIL', msg); ok = false; }
}

const items: InboxItem[] = [
  { id: 'chat', kind: 'chat', title: 'Чат', sub: '2 в чатах', href: '/chat', priority: 90 },
  { id: 'pay-1', kind: 'payment', title: 'Счёт 1', sub: '10 000 ₽', href: '/budget', priority: 85 },
  { id: 'pay-2', kind: 'payment', title: 'Счёт 2', sub: '20 000 ₽', href: '/budget', priority: 85 },
];

assert(inboxTotal(items, 0) === 3, 'total counts inbox rows');
/** @deprecated attention badge — документируем старое поведение, UI не использует */
assert(inboxAttentionBadge(items, 2) === 4, 'deprecated attention = tasks + messages');
assert(inboxTaskBadge(items) === 2, 'task badge excludes chat row');
assert(inboxAttentionBadge([{ id: 'chat', kind: 'chat', title: 'Чат', href: '/chat', priority: 90 }], 3) === 3, 'deprecated chat-only');
assert(inboxLinkItems(items, 'payment').length === 1, 'payment hero hides payment rows from link');
assert(inboxLinkItems(items, 'work').length === 3, 'non-payment hero keeps all rows');
assert(inboxTotal([], 4) === 4, 'chat unread when no chat item');
assert(
  filterInboxForHero(
    [{ id: 'acceptance', kind: 'acceptance', title: 'Приёмка', href: '/c', priority: 88 }],
    'accept',
  ).length === 0,
  'accept hero hides acceptance row',
);

// W77: warranty/change_order kinds count as tasks (not chat)
assert(
  inboxTaskBadge([
    { id: 'warranty-open', kind: 'warranty', title: 'Г', href: '/d', priority: 78 },
    { id: 'change-orders', kind: 'change_order', title: 'ДО', href: '/e', priority: 83 },
    { id: 'chat', kind: 'chat', title: 'Чат', href: '/c', priority: 90 },
  ]) === 2,
  'W77 task badge excludes chat, includes warranty+CO',
);

if (!ok) process.exit(1);
console.log('buildInboxItems.test OK');
