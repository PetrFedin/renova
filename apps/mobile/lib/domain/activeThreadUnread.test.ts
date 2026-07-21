/**
 * Active thread read policy + incoming message decisions.
 * Run: npx tsx apps/mobile/lib/domain/activeThreadUnread.test.ts
 */
import {
  EMPTY_ACTIVE_THREAD_CONTEXT,
  isActivelyReadingThread,
  type ActiveThreadContext,
} from './activeThreadContext';
import {
  clearIncomingMessageDedupe,
  clampSnapshotForActiveRead,
  decideIncomingChatMessage,
} from './incomingChatMessage';
import { sumActiveThreadUnread } from './chatUnreadSnapshot';
import type { ChatThread } from '../api/types/chat';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const reading: ActiveThreadContext = {
  threadId: 't1',
  userId: 'u1',
  projectId: 'p1',
  screenFocused: true,
  appForeground: true,
  messagesVisible: true,
  threadLoaded: true,
  accessConfirmed: true,
};

clearIncomingMessageDedupe();

// 1. сообщение в открытом треде — suppress + mark-read
{
  const d = decideIncomingChatMessage({
    event: { messageId: 'm1', threadId: 't1' },
    active: reading,
  });
  assert(d.accept && !d.bumpUnread && d.shouldMarkRead, 'open thread suppress');
  assert(d.reason === 'applied_suppress', 'suppress reason');
}

// 2. сообщение в другом треде — bump
{
  const d = decideIncomingChatMessage({
    event: { messageId: 'm2', threadId: 't2' },
    active: reading,
  });
  assert(d.accept && d.bumpUnread && !d.shouldMarkRead, 'other thread bump');
}

// 3. background — bump даже для того же threadId
{
  const d = decideIncomingChatMessage({
    event: { messageId: 'm3', threadId: 't1' },
    active: { ...reading, appForeground: false },
  });
  assert(d.bumpUnread && !d.shouldMarkRead, 'background bump');
}

// 4. overlay/modal → messagesVisible false → bump
{
  const d = decideIncomingChatMessage({
    event: { messageId: 'm4', threadId: 't1' },
    active: { ...reading, messagesVisible: false },
  });
  assert(d.bumpUnread, 'overlay bump');
}

// 5. прокручен вверх — Variant A: всё ещё suppress (viewport не нужен)
{
  assert(isActivelyReadingThread(reading, 't1'), 'variant A scrolled still reading');
  const d = decideIncomingChatMessage({
    event: { messageId: 'm5', threadId: 't1' },
    active: reading,
  });
  assert(!d.bumpUnread && d.shouldMarkRead, 'scrolled up still suppress');
}

// 6. reconnect / то же messageId — duplicate
{
  const d = decideIncomingChatMessage({
    event: { messageId: 'm1', threadId: 't1' },
    active: reading,
  });
  assert(!d.accept && d.reason === 'duplicate', 'reconnect dup');
}

// 7. два события одного message ID
{
  clearIncomingMessageDedupe();
  const a = decideIncomingChatMessage({
    event: { messageId: 'dup', threadId: 't2' },
    active: reading,
  });
  const b = decideIncomingChatMessage({
    event: { messageId: 'dup', threadId: 't2' },
    active: reading,
  });
  assert(a.accept && !b.accept, 'double event');
}

// 8. сообщение от себя — accept, no bump, no mark
{
  const d = decideIncomingChatMessage({
    event: { messageId: 'self1', threadId: 't1', fromSelf: true },
    active: reading,
  });
  assert(d.accept && !d.bumpUnread && !d.shouldMarkRead && d.reason === 'from_self', 'self');
}

// 9. после переключения треда — старый context не suppress новый
{
  clearIncomingMessageDedupe();
  const switched: ActiveThreadContext = { ...reading, threadId: 't9' };
  const d = decideIncomingChatMessage({
    event: { messageId: 'sw1', threadId: 't1' },
    active: switched,
  });
  assert(d.bumpUnread, 'after switch bump old thread');
}

// 10. в момент ухода с экрана — screenFocused false → bump
{
  clearIncomingMessageDedupe();
  const d = decideIncomingChatMessage({
    event: { messageId: 'leave1', threadId: 't1' },
    active: { ...reading, screenFocused: false },
  });
  assert(d.bumpUnread && !isActivelyReadingThread(
    { ...reading, screenFocused: false },
    't1',
  ), 'leaving screen');
}

// clamp snapshot: активный тред → unread 0 в той же транзакции
{
  const threads = [
    {
      id: 't1',
      project_id: 'p1',
      title: 'a',
      topic: null,
      updated_at: 'x',
      last_message: null,
      unread_count: 3,
    },
    {
      id: 't2',
      project_id: 'p1',
      title: 'b',
      topic: null,
      updated_at: 'x',
      last_message: null,
      unread_count: 2,
    },
  ] as ChatThread[];
  const clamped = clampSnapshotForActiveRead(
    { threads, totalUnreadMessages: 5 },
    reading,
    sumActiveThreadUnread,
  );
  assert(clamped.threads.find((t) => t.id === 't1')?.unread_count === 0, 'clamp t1');
  assert(clamped.totalUnreadMessages === 2, 'clamp total');
}

// threadId alone insufficient
{
  assert(!isActivelyReadingThread({
    ...EMPTY_ACTIVE_THREAD_CONTEXT,
    threadId: 't1',
    userId: 'u1',
  }, 't1'), 'threadId only');
}

console.log('activeThreadUnread.test OK');
