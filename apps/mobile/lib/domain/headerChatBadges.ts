/**
 * Семантика бейджей шапки/dock (SoT: inboxSyncStore.totalUnread / taskBadge).
 *
 * Красный — только непрочитанные сообщения.
 * Жёлтый — только задачи «Входящие».
 * Один слот badge НЕ переключает смысл chat ↔ tasks.
 */

export type HeaderMoreBadge = {
  count: number;
  /** warning = задачи; chat на «Ещё» больше не показываем (отдельная иконка сообщений) */
  tone: 'warning';
  kind: 'tasks';
};

/**
 * Badge кнопки «Ещё»: только задачи.
 * Непрочитанные сообщения — на иконке сообщений / dock «Сообщения».
 */
export function resolveHeaderMoreBadge(taskBadge: number, _chatUnread = 0): HeaderMoreBadge | null {
  const tasks = Math.max(0, taskBadge || 0);
  if (tasks > 0) return { count: tasks, tone: 'warning', kind: 'tasks' };
  return null;
}

/** Число непрочитанных на dock «Сообщения» и верхней иконке чата. */
export function dockChatBadgeCount(chatUnread: number): number {
  return Math.max(0, chatUnread || 0);
}

/**
 * Бейджи строки «Входящие» в панели «Ещё»:
 * red = сообщения (как dock); amber = задачи.
 */
export function resolveInboxMenuBadges(taskBadge: number, chatUnread: number): {
  chat: number;
  tasks: number;
} {
  return {
    chat: dockChatBadgeCount(chatUnread),
    tasks: Math.max(0, taskBadge || 0),
  };
}
