/**
 * Политика archive/unread — unit tests.
 * Run: npx tsx apps/mobile/lib/domain/archivedChatPolicy.test.ts
 */
import {
  ARCHIVED_CHAT_POLICY,
  applyIncomingUnarchive,
  archiveUnreadExplanation,
  countArchivedWithUnread,
  dedupeThreadsById,
  isMuteActive,
  sumActiveChatUnread,
  sumArchivedChatUnread,
} from './archivedChatPolicy';

const must = (c: boolean, m: string) => {
  if (!c) throw new Error(m);
};

const threads = [
  { id: 'a', project_id: 'p', unread_count: 3, is_archived: false },
  { id: 'b', project_id: 'p', unread_count: 2, is_archived: true },
  { id: 'c', project_id: 'p', unread_count: 0, is_archived: true },
];

must(ARCHIVED_CHAT_POLICY.newMessageUnarchives, 'policy unarchive');
must(ARCHIVED_CHAT_POLICY.archiveDoesNotMarkRead, 'policy archive≠read');
must(ARCHIVED_CHAT_POLICY.globalUnreadExcludesArchived, 'policy global excludes archive leftovers');

must(sumActiveChatUnread(threads) === 3, 'global = active only');
must(sumArchivedChatUnread(threads) === 2, 'archive unread separate');
must(countArchivedWithUnread(threads) === 1, 'one archived with unread');

// Архивировать unread тред: global падает, archive растёт; unread не обнуляется
const afterArchive = threads.map((t) => (t.id === 'a' ? { ...t, is_archived: true } : t));
must(sumActiveChatUnread(afterArchive) === 0, 'archive unread thread → global 0');
must(sumArchivedChatUnread(afterArchive) === 5, 'unread preserved in archive');

// Новое сообщение → unarchive
const afterMsg = applyIncomingUnarchive(afterArchive, 'a', { bumpUnreadBy: 1 });
must(afterMsg.find((t) => t.id === 'a')!.is_archived === false, 'unarchived');
must(afterMsg.find((t) => t.id === 'a')!.unread_count === 4, 'unread bumped');
must(sumActiveChatUnread(afterMsg) === 4, 'back in global');
must(afterMsg.length === 3, 'no duplicate threads');

// Duplicate event idempotent-ish: second unarchive stays one row
const afterDup = applyIncomingUnarchive(afterMsg, 'a', { bumpUnreadBy: 1 });
must(dedupeThreadsById(afterDup).length === 3, 'dedupe');
must(sumActiveChatUnread(afterDup) === 5, 'second bump');

// Mute отдельно
must(isMuteActive(null) === false, 'no mute');
must(isMuteActive(new Date(Date.now() + 60_000).toISOString()) === true, 'muted future');
must(isMuteActive(new Date(Date.now() - 60_000).toISOString()) === false, 'mute expired');

const expl = archiveUnreadExplanation(2, 1);
must(expl.includes('не входят в бейдж'), 'explains global');
must(expl.includes('Новое входящее'), 'explains unarchive');
must(expl.includes('не отмечает'), 'explains archive≠read');

console.log('archivedChatPolicy.test OK');
