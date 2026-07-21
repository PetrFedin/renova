/**
 * Устойчивая семантика бейджей навигации.
 *
 * Одна кнопка — один тип счётчика. Число не меняет смысл.
 *
 * | UI              | Поле              | Цвет     | Источник              |
 * |-----------------|-------------------|----------|------------------------|
 * | Dock «Сообщения»| unreadMessages    | danger   | inboxSyncStore         |
 * | Dock «Календарь»| dueTasks          | warning  | useTodayTaskCount     |
 * | Шапка «Ещё»     | notifications     | warning  | inbox tasks (без чата) |
 *
 * Сообщения и задачи никогда не суммируются в одно необъяснимое `count`.
 */

export type NavigationBadges = {
  /** Непрочитанные сообщения (все активные чаты пользователя) */
  unreadMessages: number;
  /** Актуальные задачи на сегодня (календарь / home fallback) */
  dueTasks: number;
  /**
   * События раздела «Ещё» / «Входящие» без чата (оплаты, приёмка и т.д.).
   * Если 0 — badge на «Ещё» не показывается (даже при unreadMessages > 0).
   */
  notifications: number;
};

export type NavBadgeTone = 'danger' | 'warning';

export type ResolvedNavBadge = {
  count: number;
  display: string;
  tone: NavBadgeTone;
  kind: keyof NavigationBadges;
};

/** NaN / Infinity / отрицательные → 0; дробные → trunc */
export function normalizeBadgeCount(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.trunc(n);
}

/** 0 → null (скрыть), 1–99 → строка числа, >99 → «99+» */
export function formatNavBadgeDisplay(count: number): string | null {
  const n = normalizeBadgeCount(count);
  if (n <= 0) return null;
  if (n > 99) return '99+';
  return String(n);
}

export function buildNavigationBadges(input: {
  unreadMessages?: unknown;
  dueTasks?: unknown;
  notifications?: unknown;
}): NavigationBadges {
  return {
    unreadMessages: normalizeBadgeCount(input.unreadMessages),
    dueTasks: normalizeBadgeCount(input.dueTasks),
    notifications: normalizeBadgeCount(input.notifications),
  };
}

function resolveSlot(
  kind: keyof NavigationBadges,
  count: number,
  tone: NavBadgeTone,
): ResolvedNavBadge | null {
  const n = normalizeBadgeCount(count);
  const display = formatNavBadgeDisplay(n);
  if (!display) return null;
  return { count: n, display, tone, kind };
}

/** Dock / header: только непрочитанные сообщения */
export function resolveMessagesTabBadge(badges: NavigationBadges): ResolvedNavBadge | null {
  return resolveSlot('unreadMessages', badges.unreadMessages, 'danger');
}

/** Dock календарь / home: только dueTasks */
export function resolveCalendarTabBadge(badges: NavigationBadges): ResolvedNavBadge | null {
  return resolveSlot('dueTasks', badges.dueTasks, 'warning');
}

/**
 * Кнопка «Ещё»: только notifications.
 * Никогда не показывает unreadMessages — иначе после прочтения чата
 * тот же слот начал бы означать задачи.
 */
export function resolveMoreTabBadge(badges: NavigationBadges): ResolvedNavBadge | null {
  return resolveSlot('notifications', badges.notifications, 'warning');
}

/** Подписанные значения строки «Входящие» (не обезличенные кружки) */
export function resolveInboxLabeledCounts(badges: NavigationBadges): {
  messages: number;
  tasks: number;
} {
  return {
    messages: badges.unreadMessages,
    tasks: badges.notifications,
  };
}

/** A11y: «Сообщения» / «Сообщения, 5 непрочитанных» */
export function messagesTabA11yLabel(unreadMessages: number, tabLabel = 'Сообщения'): string {
  const n = normalizeBadgeCount(unreadMessages);
  if (n <= 0) return tabLabel;
  return `${tabLabel}, ${n} непрочитанных`;
}

/** A11y: «Календарь, 3 задачи на сегодня» */
export function calendarTabA11yLabel(dueTasks: number, tabLabel = 'Календарь'): string {
  const n = normalizeBadgeCount(dueTasks);
  if (n <= 0) return tabLabel;
  if (n === 1) return `${tabLabel}, 1 задача на сегодня`;
  if (n >= 2 && n <= 4) return `${tabLabel}, ${n} задачи на сегодня`;
  return `${tabLabel}, ${n} задач на сегодня`;
}

/**
 * A11y «Ещё» — только notifications.
 * chatUnread намеренно игнорируется (оставлен для совместимости вызовов).
 */
export function moreTabA11yLabel(notifications: number, _unreadMessages = 0): string {
  const n = normalizeBadgeCount(notifications);
  if (n <= 0) return 'Ещё';
  if (n === 1) return 'Ещё, 1 задача требует внимания';
  if (n >= 2 && n <= 4) return `Ещё, ${n} задачи требуют внимания`;
  return `Ещё, ${n} задач требуют внимания`;
}

/**
 * Инвариант: после обнуления сообщений слот More не «наследует» бывший chat count
 * и не меняет kind — всегда notifications.
 */
export function assertStableMoreSemantics(
  before: NavigationBadges,
  afterMessagesCleared: NavigationBadges,
): boolean {
  const moreBefore = resolveMoreTabBadge(before);
  const moreAfter = resolveMoreTabBadge(afterMessagesCleared);
  if (before.notifications === 0) return moreAfter === null;
  return (
    moreBefore?.kind === 'notifications'
    && moreAfter?.kind === 'notifications'
    && moreAfter.count === afterMessagesCleared.notifications
    && moreAfter.count === before.notifications
  );
}
