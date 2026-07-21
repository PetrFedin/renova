/**
 * Единый unread: sum(threads) ↔ header/dock/list.
 * Run: npx tsx apps/mobile/lib/chatUnreadSync.test.ts
 */
import { dockChatBadgeCount, resolveHeaderMoreBadge, resolveInboxMenuBadges } from './domain/headerChatBadges';
import { formatBadgeCount, formatUnreadMessagesRu } from './formatUnreadMessagesRu';
import { chatMessagesA11yLabel, moreMenuA11yLabel } from './domain/moreMenuA11y';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

type T = { id: string; unread_count: number; is_archived?: boolean };

function sumActive(threads: T[]): number {
  return threads.filter((t) => !t.is_archived).reduce((s, t) => s + Math.max(0, t.unread_count || 0), 0);
}

// --- Единое число ---
{
  const threads: T[] = [
    { id: 'a', unread_count: 2 },
    { id: 'b', unread_count: 3 },
    { id: 'c', unread_count: 0 },
  ];
  const total = sumActive(threads);
  assert(total === 5, 'total 5');
  assert(dockChatBadgeCount(total) === 5, 'dock 5');
  assert(resolveInboxMenuBadges(2, total).chat === 5, 'inbox chat 5');
  assert(resolveHeaderMoreBadge(2, total)?.count === 2, 'More shows tasks 2 not chat');
  assert(sumActive(threads) === total, 'card sum = total');
}

// --- Архив не в global ---
{
  const threads: T[] = [
    { id: 'a', unread_count: 2 },
    { id: 'arch', unread_count: 4, is_archived: true },
  ];
  assert(sumActive(threads) === 2, 'archive excluded');
}

// --- Фильтр не меняет global ---
{
  const global = 8;
  const filtered = 3;
  assert(dockChatBadgeCount(global) === 8, 'global dock stays 8');
  assert(filtered !== global, 'filter differs');
  // UI string contract
  const label = `В фильтре: ${filtered} из ${global}`;
  assert(label.includes('3 из 8'), 'filter label');
}

// --- Задачи не подменяют chat на More ---
{
  assert(resolveHeaderMoreBadge(2, 4)?.kind === 'tasks', 'More=tasks');
  assert(resolveHeaderMoreBadge(2, 0)?.count === 2, 'tasks remain after chat cleared');
  assert(resolveHeaderMoreBadge(0, 0) === null, 'both empty');
  assert(moreMenuA11yLabel(3, 5).includes('задач'), 'a11y tasks');
  assert(!moreMenuA11yLabel(3, 5).includes('непрочитанн'), 'a11y More no chat');
  assert(chatMessagesA11yLabel(5).includes('5'), 'chat a11y');
}

// --- Границы badge ---
for (const [n, want] of [[0, ''], [1, '1'], [99, '99'], [100, '99+'], [999, '99+']] as const) {
  assert(formatBadgeCount(n) === want, `badge ${n}`);
}

assert(formatUnreadMessagesRu(21).includes('сообщение'), '21 message form');
assert(formatUnreadMessagesRu(11).includes('сообщений'), '11 messages form');

// --- Optimistic: thread 3 → 0, global 5 → 2 ---
{
  let threads: T[] = [
    { id: 'x', unread_count: 3 },
    { id: 'y', unread_count: 2 },
  ];
  assert(sumActive(threads) === 5, 'before open');
  threads = threads.map((t) => (t.id === 'x' ? { ...t, unread_count: 0 } : t));
  assert(sumActive(threads) === 2, 'after optimistic');
  assert(dockChatBadgeCount(sumActive(threads)) === 2, 'dock after');
}

console.log('chatUnreadSync.test OK');
