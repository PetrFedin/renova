/**
 * W80: единый бейдж «Ещё» ↔ «Сообщения».
 * Непрочитанный чат — один SoT (inboxSyncStore.chatCount); задачи на иконке «Ещё» только если чата нет.
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

/** Число на dock «Сообщения» — только чат (тот же chatUnread). */
export function dockChatBadgeCount(chatUnread: number): number {
  return Math.max(0, chatUnread || 0);
}
