/**
 * Единый SoT непрочитанных сообщений: inboxSyncStore.chatCount.
 * Dock «Сообщения» — единственный красный chat-бейдж.
 * «Ещё» в шапке — только задачи (не XOR и не дубль dock chat).
 */

export type HeaderMoreBadge = {
  count: number;
  /** warning = задачи inbox (chat намеренно не дублируем с dock) */
  tone: 'danger' | 'warning';
  kind: 'chat' | 'tasks';
};

/**
 * Investor P2: шапка «Ещё» = задачи. Chat остаётся на dock «Сообщения».
 * Раньше chat XOR tasks прятал задачи при unread>0 и дублировал dock.
 */
export function resolveHeaderMoreBadge(taskBadge: number, chatUnread: number): HeaderMoreBadge | null {
  const tasks = Math.max(0, taskBadge || 0);
  // chatUnread оставлен в сигнатуре для совместимости вызовов / тестов inbox row
  void chatUnread;
  if (tasks > 0) return { count: tasks, tone: 'warning', kind: 'tasks' };
  return null;
}

/** Число непрочитанных на dock «Сообщения» и красном бейдже строки «Входящие». */
export function dockChatBadgeCount(chatUnread: number): number {
  return Math.max(0, chatUnread || 0);
}

/**
 * Бейджи строки «Входящие» в панели «Ещё»:
 * red = то же, что dock «Сообщения»; amber = задачи.
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
