/** Стабильная семантика navigation badges: chat и tasks никогда не смешиваются. */

export type HeaderMoreBadge = {
  count: number;
  tone: 'warning';
  kind: 'tasks';
};

/** Кнопка «Ещё» показывает только taskBadge. chatUnread намеренно игнорируется. */
export function resolveHeaderMoreBadge(taskBadge: number, _chatUnread = 0): HeaderMoreBadge | null {
  const tasks = Math.max(0, taskBadge || 0);
  return tasks > 0 ? { count: tasks, tone: 'warning', kind: 'tasks' } : null;
}

/** Dock «Сообщения» показывает только global unread сообщений. */
export function dockChatBadgeCount(chatUnread: number): number {
  return Math.max(0, chatUnread || 0);
}

/** Строка «Входящие» содержит два явно подписанных независимых счётчика. */
export function resolveInboxMenuBadges(taskBadge: number, chatUnread: number): {
  chat: number;
  tasks: number;
} {
  return {
    chat: dockChatBadgeCount(chatUnread),
    tasks: Math.max(0, taskBadge || 0),
  };
}
