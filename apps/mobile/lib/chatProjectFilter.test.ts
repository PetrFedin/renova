/** Дедупликация чатов по названию внутри объекта */
import type { ChatThread } from '@/lib/api';
import { dedupeChatThreadsByTitle } from './chatProjectFilter';

const threads: ChatThread[] = [
  { id: '1', project_id: 'p1', title: 'Общий чат', topic: null, updated_at: '2026-01-02T10:00:00', unread_count: 0, is_pinned: false, is_archived: false, pinned_at: null, last_message: null },
  { id: '2', project_id: 'p1', title: 'Общий чат', topic: null, updated_at: '2026-01-03T10:00:00', unread_count: 0, is_pinned: false, is_archived: false, pinned_at: null, last_message: null },
  { id: '3', project_id: 'p2', title: 'Общий чат', topic: null, updated_at: '2026-01-01T10:00:00', unread_count: 0, is_pinned: false, is_archived: false, pinned_at: null, last_message: null },
];

const deduped = dedupeChatThreadsByTitle(threads);
console.assert(deduped.length === 2, 'keeps one per project+title');
console.assert(deduped.find((t) => t.id === '2'), 'keeps newest duplicate');
console.log('chatProjectFilter dedupe OK');
