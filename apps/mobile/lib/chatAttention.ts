/** Непрочитанные + «ждёт вашего ответа» — для badge и списка чатов */
import type { ChatThread } from '@/lib/api';
import { isChatCreationSystemMessage } from './chatPreview';

type ViewerRole = 'customer' | 'contractor' | 'viewer' | undefined;

export function threadAwaitingReply(thread: ChatThread, viewerRole: ViewerRole): boolean {
  if (!viewerRole || viewerRole === 'viewer') return false;
  const last = thread.last_message;
  if (!last?.author_role || isChatCreationSystemMessage(last)) return false;
  if (last.author_role === 'system') return false;
  const other = viewerRole === 'customer' ? 'contractor' : 'customer';
  return last.author_role === other;
}

/** Вес для badge: unread или 1 если ждёт ответа */
export function threadAttentionWeight(thread: ChatThread, viewerRole: ViewerRole): number {
  const unread = thread.unread_count || 0;
  if (unread > 0) return unread;
  if (thread.is_archived) return 0;
  return threadAwaitingReply(thread, viewerRole) ? 1 : 0;
}

export function inboxAttentionTotal(threads: ChatThread[], viewerRole: ViewerRole): number {
  return threads.reduce((sum, t) => sum + threadAttentionWeight(t, viewerRole), 0);
}

export function threadsAwaitingReplyCount(threads: ChatThread[], viewerRole: ViewerRole): number {
  return threads.filter((t) => !t.is_archived && threadAwaitingReply(t, viewerRole)).length;
}
