/**
 * Атомарный chat unread snapshot.
 * Run: npx tsx apps/mobile/lib/domain/chatUnreadSnapshot.test.ts
 */
import type { ChatThread } from '../api/types/chat';
import {
  applyChatUnreadSnapshot,
  checkUnreadInvariant,
  parseChatUnreadSnapshotApi,
  patchThreadUnreadInSnapshot,
  removeThreadFromSnapshot,
  setThreadArchivedInSnapshot,
  snapshotFromThreads,
  sumActiveThreadUnread,
  sumThreadUnread,
  threadsFromChatInbox,
} from './chatUnreadSnapshot';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const t = (
  id: string,
  unread: number,
  archived = false,
  project = 'p1',
): ChatThread => ({
  id,
  project_id: project,
  title: id,
  topic: null,
  updated_at: '2024-01-01T00:00:00Z',
  last_message: null,
  unread_count: unread,
  is_archived: archived,
});

// полный snapshot
{
  const snap = snapshotFromThreads([t('a', 3), t('b', 5), t('c', 0)], 100);
  assert(snap.totalUnreadMessages === 8, 'full total');
  assert(checkUnreadInvariant(snap).ok, 'full invariant');
}

// частичное WS-обновление
{
  let snap = snapshotFromThreads([t('a', 3), t('b', 5)], 10);
  snap = patchThreadUnreadInSnapshot(snap, 'a', 0, 11);
  assert(snap.totalUnreadMessages === 5, 'patch total');
  assert(snap.threads.find((x) => x.id === 'a')?.unread_count === 0, 'patch thread');
  assert(snap.revision >= 11, 'patch revision');
  assert(checkUnreadInvariant(snap).ok, 'patch invariant');
}

// архивный чат не в total
{
  const snap = snapshotFromThreads([t('a', 2), t('b', 4, true)], 1);
  assert(snap.totalUnreadMessages === 2, 'archive excluded');
  assert(sumActiveThreadUnread(snap.threads) === 2, 'sum active');
}

// восстановление архива
{
  let snap = snapshotFromThreads([t('a', 2), t('b', 4, true)], 1);
  snap = setThreadArchivedInSnapshot(snap, 'b', false, 2);
  assert(snap.totalUnreadMessages === 6, 'unarchive adds');
}

// новый тред через full snapshot
{
  const prev = snapshotFromThreads([t('a', 1)], 5);
  const next = snapshotFromThreads([t('a', 1), t('n', 7)], 6);
  const r = applyChatUnreadSnapshot(prev, next);
  assert(r.ok && r.snapshot.totalUnreadMessages === 8, 'new thread');
}

// удалённый тред
{
  let snap = snapshotFromThreads([t('a', 2), t('b', 3)], 1);
  snap = removeThreadFromSnapshot(snap, 'b', 2);
  assert(snap.totalUnreadMessages === 2 && snap.threads.length === 1, 'removed');
}

// read event
{
  let snap = snapshotFromThreads([t('a', 4), t('b', 1)], 1);
  snap = patchThreadUnreadInSnapshot(snap, 'a', 0);
  assert(snap.totalUnreadMessages === 1, 'read');
}

// старый snapshot после нового
{
  const cur = snapshotFromThreads([t('a', 9)], 50);
  const stale = snapshotFromThreads([t('a', 1)], 40);
  const r = applyChatUnreadSnapshot(cur, stale);
  assert(!r.ok && r.reason === 'stale_revision', 'stale rejected');
  assert(r.snapshot.totalUnreadMessages === 9, 'kept current');
}

// network force: старый revision всё равно применяется (SoT GET)
{
  const cur = snapshotFromThreads([t('a', 9)], 50);
  const net = snapshotFromThreads([t('a', 2), t('b', 1)], 40);
  const r = applyChatUnreadSnapshot(cur, net, { force: true });
  assert(r.ok && r.snapshot.totalUnreadMessages === 3, 'force network');
  assert(r.snapshot.revision >= 50, 'force keeps monotonic');
}

// threadsFromChatInbox
{
  const list = threadsFromChatInbox({
    revision: 1,
    total_unread_messages: 3,
    threads: [t('a', 3)],
  });
  assert(list.length === 1 && list[0].id === 'a', 'threadsFromChatInbox');
}

// offline cache / dirty parse
{
  const snap = parseChatUnreadSnapshotApi({
    revision: 3,
    total_unread_messages: 99, // лживый total — пересчитаем из threads
    threads: [t('a', 2), t('b', 3)],
  });
  assert(snap.totalUnreadMessages === 5, 'recompute over reported');
}

// смена проекта — visible <= total
{
  const snap = snapshotFromThreads([t('a', 2, false, 'p1'), t('b', 5, false, 'p2')], 1);
  const visible = snap.threads.filter((x) => x.project_id === 'p1');
  const r = checkUnreadInvariant(snap, visible);
  assert(r.ok && r.sumVisible === 2 && r.total === 7, 'project filter');
}

// смена пользователя — пустой snapshot
{
  const empty = snapshotFromThreads([], 1);
  assert(empty.totalUnreadMessages === 0, 'user clear');
}

// pagination: partial page не является SoT — документируем через sumVisible <= total
{
  const full = snapshotFromThreads([t('a', 2), t('b', 3), t('c', 4)], 1);
  const page = full.threads.slice(0, 2);
  assert(sumThreadUnread(page) <= full.totalUnreadMessages, 'page <= total');
  assert(checkUnreadInvariant(full, page).ok, 'page invariant');
}

// legacy array
{
  const snap = parseChatUnreadSnapshotApi([t('a', 1), t('b', 2)], 7);
  assert(snap.revision === 7 && snap.totalUnreadMessages === 3, 'legacy array');
}

console.log('chatUnreadSnapshot.test OK');
