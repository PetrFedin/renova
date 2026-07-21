/**
 * Smoke: wiring политики archive/unread.
 * Run: npx tsx apps/mobile/lib/domain/archivedChatPolicy.smoke.test.ts
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '../..');
const must = (c: boolean, m: string) => {
  if (!c) throw new Error(m);
};
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

const svc = readFileSync(join(root, '../../backend/app/services/chat_service.py'), 'utf8');
must(svc.includes('unarchive_recipients'), 'backend unarchive_recipients');
must(svc.includes('Архивация НЕ сдвигает last_read_at') || svc.includes('archive ≠ read') || svc.includes('не трогает last_read_at'), 'archive≠read comment');
must(svc.includes('_is_muted'), 'mute helper');
must(svc.includes('unarchived'), 'WS payload unarchived');

const list = read('components/renova/chat/ChatListView.tsx');
must(list.includes('archiveUnreadExplanation') || list.includes('архив'), 'archive UI copy');
must(list.includes('sumArchivedChatUnread') || list.includes('archivedUnread'), 'archive unread explained');
must(list.includes('is_muted') || list.includes('muted'), 'muted badge separate');

const store = read('lib/inboxSyncStore.ts');
must(store.includes('sumActiveChatUnread') || store.includes('!t.is_archived'), 'global excludes archived leftovers');
must(store.includes('applyIncomingUnarchive') || store.includes('unarchived'), 'WS unarchive apply');

must(read('../../ARCHIVED-CHAT-UNREAD-POLICY.md').includes('auto-unarchive') || read('../../ARCHIVED-CHAT-UNREAD-POLICY.md').includes('снимает archive'), 'policy doc');

console.log('archivedChatPolicy.smoke.test OK');
