/** API: chats */
import {req, cachedGet, API_BASE, ApiError, authHeaders} from './client';
import type { ChatDetail, ChatMessage, ChatThread, User } from './types';
export const chatsApi = {
  listChats: (userId: string, projectId: string, archived = false) =>
    req<ChatThread[]>(`/api/v1/projects/${projectId}/chats?archived=${archived ? 'true' : 'false'}`, {}, userId),
  chatInbox: (userId: string) => req<ChatThread[]>(`/api/v1/chats/inbox`, {}, userId),
  chatUnreadTotal: (userId: string) => req<{ count: number }>(`/api/v1/chats/unread-total`, {}, userId),
  createChat: async (userId: string, projectId: string, title: string, topic?: string) => {
    const body = JSON.stringify({ title, topic });
    try {
      return await req<ChatThread>(`/api/v1/projects/${projectId}/chats`, { method: 'POST', body }, userId);
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({ path: `/api/v1/projects/${projectId}/chats`, method: 'POST', body, userId });
      throw new Error('offline_queued');
    }
  },
  patchChatState: async (
    userId: string,
    projectId: string,
    threadId: string,
    body: {
      is_pinned?: boolean;
      is_archived?: boolean;
      muted_until?: string | null;
      clear_mute?: boolean;
    },
  ) => {
    try {
      return await req(
        `/api/v1/projects/${projectId}/chats/${threadId}/state`,
        { method: 'PATCH', body: JSON.stringify(body) },
        userId,
      );
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({
        path: `/api/v1/projects/${projectId}/chats/${threadId}/state`,
        method: 'PATCH',
        body: JSON.stringify(body),
        userId,
      });
      throw new Error('offline_queued');
    }
  },
  inviteToChat: (userId: string, projectId: string, threadId: string, body: { phone?: string; profile_code?: string }) =>
    req(`/api/v1/projects/${projectId}/chats/${threadId}/invite`, { method: 'POST', body: JSON.stringify(body) }, userId),
  /** W115: реакции в чате — очередь офлайн */
  reactChatMessage: async (
    userId: string,
    projectId: string,
    threadId: string,
    messageId: string,
    emoji: string,
  ) => {
    try {
      return await req<{ reactions: Record<string, string[]> }>(
        `/api/v1/projects/${projectId}/chats/${threadId}/messages/${messageId}/react`,
        { method: 'POST', body: JSON.stringify({ emoji }) },
        userId,
      );
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({
        path: `/api/v1/projects/${projectId}/chats/${threadId}/messages/${messageId}/react`,
        method: 'POST',
        body: JSON.stringify({ emoji }),
        userId,
      });
      throw new Error('offline_queued');
    }
  },
  /** W115: закрепление сообщения — очередь офлайн */
  pinChatMessage: async (
    userId: string,
    projectId: string,
    threadId: string,
    messageId: string,
    pin = true,
  ) => {
    try {
      return await req<ChatMessage>(
        `/api/v1/projects/${projectId}/chats/${threadId}/messages/${messageId}/pin?pin=${pin}`,
        { method: 'POST' },
        userId,
      );
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({
        path: `/api/v1/projects/${projectId}/chats/${threadId}/messages/${messageId}/pin?pin=${pin}`,
        method: 'POST',
        body: '{}',
        userId,
      });
      throw new Error('offline_queued');
    }
  },
  /** W114: задача из чата → работы/календарь — очередь офлайн */
  taskFromChatMessage: async (
    userId: string,
    projectId: string,
    threadId: string,
    messageId: string,
    body: { title: string; assignee_id?: string; due_at?: string; work_type?: string },
  ) => {
    try {
      return await req<ChatMessage>(
        `/api/v1/projects/${projectId}/chats/${threadId}/messages/${messageId}/task`,
        { method: 'POST', body: JSON.stringify(body) },
        userId,
      );
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({
        path: `/api/v1/projects/${projectId}/chats/${threadId}/messages/${messageId}/task`,
        method: 'POST',
        body: JSON.stringify(body),
        userId,
      });
      throw new Error('offline_queued');
    }
  },
  /** W110: счёт из чата — очередь офлайн (связь chat → payment) */
  invoiceFromChat: async (
    userId: string,
    projectId: string,
    threadId: string,
    body: { title: string; amount: number; payment_type?: string },
  ) => {
    try {
      return await req<ChatMessage>(
        `/api/v1/projects/${projectId}/chats/${threadId}/invoice`,
        { method: 'POST', body: JSON.stringify(body) },
        userId,
      );
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({
        path: `/api/v1/projects/${projectId}/chats/${threadId}/invoice`,
        method: 'POST',
        body: JSON.stringify(body),
        userId,
      });
      throw new Error('offline_queued');
    }
  },
  /** W114: прочтение чата — очередь офлайн (inbox badge) */
  markChatRead: async (userId: string, projectId: string, threadId: string) => {
    try {
      return await req(`/api/v1/projects/${projectId}/chats/${threadId}/read`, { method: 'POST' }, userId);
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({ path: `/api/v1/projects/${projectId}/chats/${threadId}/read`, method: 'POST', body: '{}', userId });
      throw new Error('offline_queued');
    }
  },
  exportChatPdf: async (userId: string, projectId: string, threadId: string) => {
    const base = process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:8100';
    const r = await fetch(`${base}/api/v1/projects/${projectId}/chats/${threadId}.pdf`, { headers: authHeaders(userId) });
    if (!r.ok) throw new Error('PDF error');
    const blob = await r.blob();
    if (typeof window !== 'undefined') {
      const u = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = u;
      a.download = `chat-${threadId.slice(0, 8)}.pdf`;
      a.click();
      URL.revokeObjectURL(u);
    }
  },
  getChat: (userId: string, projectId: string, threadId: string) =>
    req<ChatDetail>(`/api/v1/projects/${projectId}/chats/${threadId}`, {}, userId),
  unreadChats: (userId: string, projectId: string) => req<{ count: number }>(`/api/v1/projects/${projectId}/chats/unread-count`, {}, userId),
  searchChatMessages: (userId: string, projectId: string, q: string) => req<{ thread_id: string; text: string }[]>(`/api/v1/projects/${projectId}/chats/search?q=${encodeURIComponent(q)}`, {}, userId),
  /** W114: подтверждение из чата — очередь офлайн */
  confirmChatMessage: async (userId: string, projectId: string, threadId: string, messageId: string) => {
    try {
      return await req(
        `/api/v1/projects/${projectId}/chats/${threadId}/messages/${messageId}/confirm`,
        { method: 'POST' },
        userId,
      );
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({
        path: `/api/v1/projects/${projectId}/chats/${threadId}/messages/${messageId}/confirm`,
        method: 'POST',
        body: '{}',
        userId,
      });
      throw new Error('offline_queued');
    }
  },
  sendChatMessage: async (userId: string, projectId: string, threadId: string, text: string, message_type = 'text', image_data?: string, reply_to_id?: string) => {
    try {
      return await req(`/api/v1/projects/${projectId}/chats/${threadId}/messages`, { method: 'POST', body: JSON.stringify({ text, message_type, image_data, reply_to_id }) }, userId);
    } catch (e) {
      if (e instanceof ApiError) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({ path: `/api/v1/projects/${projectId}/chats/${threadId}/messages`, method: 'POST', body: JSON.stringify({ text, message_type, image_data }), userId });
      throw new Error('offline_queued');
    }
  },
};
