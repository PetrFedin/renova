import assert from 'node:assert/strict';
import { chatListPreview, findExistingChat, isChatCreationSystemMessage, sortChatThreads } from './chatPreview';
import type { ChatThread } from './api';

const thread = (id: string, extra: Partial<ChatThread> = {}): ChatThread => ({
  id,
  project_id: 'p1',
  title: 'Test',
  topic: 'general',
  updated_at: '2026-06-28T10:00:00',
  last_message: null,
  ...extra,
});

assert.equal(isChatCreationSystemMessage({ id: '1', author_role: 'system', message_type: 'system', text: 'Чат «E2E» создан', image_url: null, created_at: '' }), true);
assert.equal(chatListPreview(thread('a', { last_message: { id: 'm', author_role: 'system', message_type: 'system', text: 'Чат «E2E» создан', image_url: null, created_at: '' } })), 'Новый чат');
assert.equal(chatListPreview(thread('b', { last_message: { id: 'm', author_role: 'customer', message_type: 'text', text: 'Привет', image_url: null, created_at: '' } })), 'Привет');

const sorted = sortChatThreads([
  thread('1', { updated_at: '2026-06-28T09:00:00', is_pinned: false }),
  thread('2', { updated_at: '2026-06-28T08:00:00', is_pinned: true }),
]);
assert.equal(sorted[0].id, '2');

assert.ok(findExistingChat([
  thread('x', { project_id: 'p1', title: 'E2E' }),
], 'p1', 'e2e'));

console.log('chatPreview.test OK');
