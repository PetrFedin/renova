/**
 * Единый SoT непрочитанных сообщений: inboxSyncStore.chatCount.
 * Dock «Сообщения», бейдж «Ещё» и пункт «Входящие» показывают одно и то же число.
 */

export type HeaderMoreBadge = {
  count: number;
  /** danger = чат (как dock); warning = задачи inbox */
  tone: 'danger' | 'warning';
  kind: 'chat' | 'tasks';
};

/**
 * Приоритет: непрочитанные сообщения (синхрон с dock) → иначе задачи «Входящие».
 */
export function buildAttentionBadgeState(input: { chatUnread: number; taskUnread: number; todayTasks?: number }): {
  chatUnread: number;
  inboxTaskUnread: number;
  calendarTodayTasks: number;
} {
  return {
    chatUnread: Math.max(0, input.chatUnread || 0),
    inboxTaskUnread: Math.max(0, input.taskUnread || 0),
    calendarTodayTasks: Math.max(0, input.todayTasks || 0),
  };
}

export function resolveHeaderMoreBadge(taskBadge: number, chatUnread: number): HeaderMoreBadge[] {
  const chat = Math.max(0, chatUnread || 0);
  const tasks = Math.max(0, taskBadge || 0);
  return [
    ...(chat > 0 ? [{ count: chat, tone: 'danger' as const, kind: 'chat' as const }] : []),
    ...(tasks > 0 ? [{ count: tasks, tone: 'warning' as const, kind: 'tasks' as const }] : []),
  ];
}

/** Число непрочитанных на dock «Сообщения» и красном бейдже «Входящие»/«Ещё». */
export function dockChatBadgeCount(chatUnread: number): number {
  return Math.max(0, chatUnread || 0);
}

/**
 * Бейджи строки «Входящие» в панели «Ещё»:
 * red = то же, что dock «Сообщения»; amber = задачи без чата.
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
