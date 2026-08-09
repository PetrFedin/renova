/** Дедупликация чатов + fail-closed project/thread resolution */
import type { ChatThread } from '@/lib/api';
import { dedupeChatThreadsByTitle } from './chatProjectFilter';
import { resolveChatProjectId } from './chatProjectResolution';
import './chatProjectResolution.w180.test';

function must(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const threads: ChatThread[] = [
    { id: '1', project_id: 'p1', title: 'Общий чат', topic: null, updated_at: '2026-01-02T10:00:00', unread_count: 0, is_pinned: false, is_archived: false, pinned_at: null, last_message: null },
    { id: '2', project_id: 'p1', title: 'Общий чат', topic: null, updated_at: '2026-01-03T10:00:00', unread_count: 0, is_pinned: false, is_archived: false, pinned_at: null, last_message: null },
    { id: '3', project_id: 'p2', title: 'Общий чат', topic: null, updated_at: '2026-01-01T10:00:00', unread_count: 0, is_pinned: false, is_archived: false, pinned_at: null, last_message: null },
  ];

  const deduped = dedupeChatThreadsByTitle(threads);
  must(deduped.length === 2, 'keeps one per project+title');
  must(deduped.some((thread) => thread.id === '2'), 'keeps newest duplicate');

  let inboxCalls = 0;
  const direct = await resolveChatProjectId({
    userId: 'u1', threadId: 't1', candidateProjectId: 'p1',
    api: {
      getChat: async () => ({}),
      chatInbox: async () => { inboxCalls += 1; return []; },
    },
  });
  must(direct === 'p1' && inboxCalls === 0, 'validated project must not use inbox fallback');

  let validatedInboxProject = '';
  const crossProject = await resolveChatProjectId({
    userId: 'u1', threadId: 't1', candidateProjectId: 'wrong',
    api: {
      getChat: async (_userId, projectId) => {
        if (projectId === 'wrong') throw { status: 404 };
        validatedInboxProject = projectId;
        return {};
      },
      chatInbox: async () => [{ id: 't1', project_id: 'right' }],
    },
  });
  must(crossProject === 'right' && validatedInboxProject === 'right', '404 may resolve only to a revalidated inbox project');

  for (const status of [401, 403, 500]) {
    inboxCalls = 0;
    let failed = false;
    try {
      await resolveChatProjectId({
        userId: 'u1', threadId: 't1', candidateProjectId: 'p1',
        api: {
          getChat: async () => { throw { status }; },
          chatInbox: async () => { inboxCalls += 1; return [{ id: 't1', project_id: 'p2' }]; },
        },
      });
    } catch {
      failed = true;
    }
    must(failed && inboxCalls === 0, `${status} must abort without project fallback`);
  }

  let transportFailed = false;
  try {
    await resolveChatProjectId({
      userId: 'u1', threadId: 't1', candidateProjectId: 'p1',
      api: {
        getChat: async () => { throw new Error('network'); },
        chatInbox: async () => [{ id: 't1', project_id: 'p2' }],
      },
    });
  } catch {
    transportFailed = true;
  }
  must(transportFailed, 'transport failure must abort resolution');

  const missing = await resolveChatProjectId({
    userId: 'u1', threadId: 'missing',
    api: {
      getChat: async () => ({}),
      chatInbox: async () => [{ id: 'other', project_id: 'p2' }],
    },
  });
  must(missing === null, 'missing thread must become explicit not-found');

  console.log('chatProjectFilter + project resolution OK');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
