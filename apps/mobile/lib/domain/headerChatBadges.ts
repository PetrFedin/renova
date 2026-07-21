/**
 * Семантика бейджей (SoT: inboxSyncStore.totalUnread / taskBadge).
 *
 * Красный — только непрочитанные сообщения (dock «Сообщения»).
 * Жёлтый — только задачи («Ещё» + TaskBadge на calendar/home).
 * Сообщения НЕ возвращаются на badge кнопки «Ещё».
 */

export type HeaderMoreBadge = {
  count: number;
  tone: 'warning';
  kind: 'tasks';
};

/** Badge кнопки «Ещё»: только задачи (жёлтый). */
export function resolveHeaderMoreBadge(taskBadge: number, _chatUnread = 0): HeaderMoreBadge | null {
  const tasks = Math.max(0, taskBadge || 0);
  if (tasks > 0) return { count: tasks, tone: 'warning', kind: 'tasks' };
  return null;
}

/** Число непрочитанных на dock «Сообщения». */
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
