import type { ChatThread } from './api';
import { threadAwaitingReply, inboxAttentionTotal } from './chatAttention';

const thread: ChatThread = {
  id: 't1',
  project_id: 'p1',
  title: 'Test',
  updated_at: '2026-07-06T12:00:00',
  last_message: {
    id: 'm1',
    thread_id: 't1',
    user_id: 'u2',
    author_role: 'contractor',
    text: 'Привет',
    message_type: 'text',
    created_at: '2026-07-06T12:00:00',
  },
};

console.assert(threadAwaitingReply(thread, 'customer') === true, 'contractor msg awaits customer');
console.assert(threadAwaitingReply(thread, 'contractor') === false, 'own msg no await');
console.assert(inboxAttentionTotal([thread], 'customer') === 1, 'attention count');
console.log('chatAttention.test OK');
