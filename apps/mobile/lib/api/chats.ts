/** API: chats */
import { req, cachedGet, API_BASE } from './client';
import type { ChatDetail, ChatMessage, ChatThread, User } from './types';
export const chatsApi = {
  listChats: (userId: string, projectId: string, archived = false) =>
    req<ChatThread[]>(`/api/v1/projects/${projectId}/chats?archived=${archived ? 'true' : 'false'}`, {}, userId),
  chatInbox: (userId: string) => req<ChatThread[]>(`/api/v1/chats/inbox`, {}, userId),
  chatUnreadTotal: (userId: string) => req<{ count: number }>(`/api/v1/chats/unread-total`, {}, userId),
  createChat: (userId: string, projectId: string, title: string, topic?: string) =>
    req<ChatThread>(`/api/v1/projects/${projectId}/chats`, { method: 'POST', body: JSON.stringify({ title, topic }) }, userId),
  patchChatState: (userId: string, projectId: string, threadId: string, body: { is_pinned?: boolean; is_archived?: boolean }) =>
    req(`/api/v1/projects/${projectId}/chats/${threadId}/state`, { method: 'PATCH', body: JSON.stringify(body) }, userId),
  inviteToChat: (userId: string, projectId: string, threadId: string, body: { phone?: string; profile_code?: string }) =>
    req(`/api/v1/projects/${projectId}/chats/${threadId}/invite`, { method: 'POST', body: JSON.stringify(body) }, userId),
  reactChatMessage: (userId: string, projectId: string, threadId: string, messageId: string, emoji: string) =>
    req<{ reactions: Record<string, string[]> }>(`/api/v1/projects/${projectId}/chats/${threadId}/messages/${messageId}/react`, { method: 'POST', body: JSON.stringify({ emoji }) }, userId),
  pinChatMessage: (userId: string, projectId: string, threadId: string, messageId: string, pin = true) =>
    req<ChatMessage>(`/api/v1/projects/${projectId}/chats/${threadId}/messages/${messageId}/pin?pin=${pin}`, { method: 'POST' }, userId),
  taskFromChatMessage: (userId: string, projectId: string, threadId: string, messageId: string, body: { title: string; assignee_id?: string; due_at?: string; work_type?: string }) =>
    req<ChatMessage>(`/api/v1/projects/${projectId}/chats/${threadId}/messages/${messageId}/task`, { method: 'POST', body: JSON.stringify(body) }, userId),
  invoiceFromChat: (userId: string, projectId: string, threadId: string, body: { title: string; amount: number; payment_type?: string }) =>
    req<ChatMessage>(`/api/v1/projects/${projectId}/chats/${threadId}/invoice`, { method: 'POST', body: JSON.stringify(body) }, userId),
  markChatRead: (userId: string, projectId: string, threadId: string) => req(`/api/v1/projects/${projectId}/chats/${threadId}/read`, { method: 'POST' }, userId),
  exportChatPdf: async (userId: string, projectId: string, threadId: string) => {
    const base = process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:8100';
    const r = await fetch(`${base}/api/v1/projects/${projectId}/chats/${threadId}.pdf`, { headers: { 'X-User-Id': userId } });
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
  confirmChatMessage: (userId: string, projectId: string, threadId: string, messageId: string) =>
    req(`/api/v1/projects/${projectId}/chats/${threadId}/messages/${messageId}/confirm`, { method: 'POST' }, userId),
  sendChatMessage: async (userId: string, projectId: string, threadId: string, text: string, message_type = 'text', image_data?: string, reply_to_id?: string) => {
    try {
      return await req(`/api/v1/projects/${projectId}/chats/${threadId}/messages`, { method: 'POST', body: JSON.stringify({ text, message_type, image_data, reply_to_id }) }, userId);
    } catch {
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({ path: `/api/v1/projects/${projectId}/chats/${threadId}/messages`, method: 'POST', body: JSON.stringify({ text, message_type, image_data }), userId });
      throw new Error('offline_queued');
    }
  },
};
