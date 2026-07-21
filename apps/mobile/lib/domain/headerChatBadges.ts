/**
 * Бейджи шапки/меню «Входящие» на базе InboxCounters.
 * Сообщения и задачи не складываются и не подменяют друг друга в одном слоте.
 */
import {
  inboxActionItemTotal,
  type InboxCounters,
} from './inboxCounters';

export type HeaderMoreBadge = {
  count: number;
  /** warning = action-категории; chat на «Ещё» не показываем */
  tone: 'warning';
  kind: 'tasks';
};

/**
 * «Ещё»: только action-единицы (без сообщений).
 * chatUnread игнорируется — иначе после прочтения чата слот менял бы смысл.
 */
export function resolveHeaderMoreBadge(taskBadge: number, _chatUnread = 0): HeaderMoreBadge | null {
  const tasks = Math.max(0, taskBadge || 0);
  if (tasks > 0) return { count: tasks, tone: 'warning', kind: 'tasks' };
  return null;
}

export function resolveHeaderMoreBadgeFromCounters(c: InboxCounters): HeaderMoreBadge | null {
  return resolveHeaderMoreBadge(inboxActionItemTotal(c), c.unreadMessages);
}

export function dockChatBadgeCount(chatUnread: number): number {
  return Math.max(0, chatUnread || 0);
}

/** Подписанные значения строки «Входящие» в меню «Ещё» */
export function resolveInboxMenuBadges(taskBadge: number, chatUnread: number): {
  chat: number;
  tasks: number;
} {
  return {
    chat: dockChatBadgeCount(chatUnread),
    tasks: Math.max(0, taskBadge || 0),
  };
}

export function resolveInboxMenuBadgesFromCounters(c: InboxCounters): {
  chat: number;
  tasks: number;
  approvals: number;
  payments: number;
  quality: number;
} {
  return {
    chat: c.unreadMessages,
    tasks: c.activeTasks,
    approvals: c.pendingApprovals,
    payments: c.paymentActions,
    quality: c.qualityActions,
  };
}
