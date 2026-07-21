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
export function resolveHeaderMoreBadge(taskBadge: number, chatUnread: number): HeaderMoreBadge | null {
  const chat = Math.max(0, chatUnread || 0);
  const tasks = Math.max(0, taskBadge || 0);
  if (chat > 0) return { count: chat, tone: 'danger', kind: 'chat' };
  if (tasks > 0) return { count: tasks, tone: 'warning', kind: 'tasks' };
  return null;
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
