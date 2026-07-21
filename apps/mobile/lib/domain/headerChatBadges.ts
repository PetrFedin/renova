/**
 * Адаптер бейджей шапки/dock → NavigationBadges (устойчивая семантика).
 * «Ещё» больше не переключает chat ↔ tasks в одном слоте.
 */
import {
  buildNavigationBadges,
  formatNavBadgeDisplay,
  resolveInboxLabeledCounts,
  resolveMessagesTabBadge,
  resolveMoreTabBadge,
  type NavigationBadges,
  type ResolvedNavBadge,
} from './navigationBadges';

export type { NavigationBadges, ResolvedNavBadge };

export type HeaderMoreBadge = {
  count: number;
  /** Только warning: задачи раздела «Ещё». Сообщения — на dock «Сообщения». */
  tone: 'warning';
  kind: 'tasks';
};

/**
 * Badge кнопки «Ещё»: только notifications (inbox tasks без чата).
 * unreadMessages игнорируется — иначе после прочтения чата слот менял бы смысл.
 */
export function resolveHeaderMoreBadge(taskBadge: number, chatUnread = 0): HeaderMoreBadge | null {
  const badges = buildNavigationBadges({
    notifications: taskBadge,
    unreadMessages: chatUnread,
  });
  const resolved = resolveMoreTabBadge(badges);
  if (!resolved) return null;
  return { count: resolved.count, tone: 'warning', kind: 'tasks' };
}

/** Число непрочитанных на dock «Сообщения». */
export function dockChatBadgeCount(chatUnread: number): number {
  return buildNavigationBadges({ unreadMessages: chatUnread }).unreadMessages;
}

/**
 * Строка «Входящие» в меню «Ещё»:
 * messages = unreadMessages; tasks = notifications (раздельно, с подписями в UI).
 */
export function resolveInboxMenuBadges(taskBadge: number, chatUnread: number): {
  chat: number;
  tasks: number;
} {
  const labeled = resolveInboxLabeledCounts(
    buildNavigationBadges({ notifications: taskBadge, unreadMessages: chatUnread }),
  );
  return { chat: labeled.messages, tasks: labeled.tasks };
}

/** Display-строка badge (null = скрыть) */
export function formatHeaderBadgeCount(count: number): string | null {
  return formatNavBadgeDisplay(count);
}

/** Dock messages badge через центральную модель */
export function resolveDockMessagesBadge(chatUnread: number): ResolvedNavBadge | null {
  return resolveMessagesTabBadge(buildNavigationBadges({ unreadMessages: chatUnread }));
}
