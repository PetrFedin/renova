/** Чистая логика ленты уведомлений: группировка, счётчик, разрешение ссылки по роли (COM-001). */
import type { AppNotification } from '@/lib/api/types/misc';
import type { OsRole } from '@/constants/osSections';
import { resolveNotificationLink, resolvePushLink, type PushTarget } from '@/lib/pushLinks';

export const NOTIFICATIONS_ROUTE = '/notification-center';
export const NOTIFICATIONS_PAGE_SIZE = 30;

export type NotificationDayGroup = { key: string; label: string; items: AppNotification[] };

function dayStart(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

export function dayLabel(date: Date, now: Date): string {
  const diff = Math.round((dayStart(now) - dayStart(date)) / DAY_MS);
  if (diff === 0) return 'Сегодня';
  if (diff === 1) return 'Вчера';
  const year = date.getFullYear() === now.getFullYear() ? '' : ` ${date.getFullYear()}`;
  return `${date.getDate()} ${MONTHS[date.getMonth()]}${year}`;
}

/** Группы по календарным дням (новые сверху); порядок внутри дня сохраняется. */
export function groupNotificationsByDay(items: AppNotification[], now: Date = new Date()): NotificationDayGroup[] {
  const groups: NotificationDayGroup[] = [];
  const byKey = new Map<string, NotificationDayGroup>();
  for (const item of items) {
    const parsed = new Date(item.created_at);
    const valid = !Number.isNaN(parsed.getTime());
    const key = valid ? String(dayStart(parsed)) : 'unknown';
    let group = byKey.get(key);
    if (!group) {
      group = { key, label: valid ? dayLabel(parsed, now) : 'Без даты', items: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}

export function countUnread(items: AppNotification[]): number {
  return items.reduce((sum, n) => sum + (n.read ? 0 : 1), 0);
}

/** Страницы ленты склеиваются без дублей (сдвиг offset при новых записях). */
export function mergeNotificationPages(current: AppNotification[], next: AppNotification[]): AppNotification[] {
  const seen = new Set(current.map((n) => n.id));
  return [...current, ...next.filter((n) => !seen.has(n.id))];
}

export function markReadLocal(items: AppNotification[], id: string): AppNotification[] {
  return items.map((n) => (n.id === id && !n.read ? { ...n, read: true } : n));
}

export function markAllReadLocal(items: AppNotification[]): AppNotification[] {
  return items.map((n) => (n.read ? n : { ...n, read: true }));
}

export function formatBadge(count: number): string {
  const n = Math.max(0, count || 0);
  return n > 99 ? '99+' : String(n);
}

export function bellA11yLabel(count: number): string {
  const n = Math.max(0, count || 0);
  return n > 0 ? `Уведомления, непрочитанных: ${n}` : 'Уведомления';
}

/** Ссылка, сохранённая для другой роли, переписывается в группу роли пользователя. */
export function localizeLinkForRole(link: string, role: OsRole): string {
  const other = role === 'contractor' ? 'customer' : 'contractor';
  return link.startsWith(`/(${other})/`) ? `/(${role})/${link.slice(`/(${other})/`.length)}` : link;
}

function stripReturnTo(link: string): string {
  const q = link.indexOf('?');
  if (q === -1) return link;
  const params = new URLSearchParams(link.slice(q + 1));
  params.delete('returnTo');
  const rest = params.toString();
  return rest ? `${link.slice(0, q)}?${rest}` : link.slice(0, q);
}

/**
 * Куда вести по нажатию: сохранённая ссылка уведомления (через resolvePushLink,
 * тот же SoT, что push), иначе маршрут по типу. Роль — из сессии пользователя.
 * Возврат ведёт в ленту уведомлений.
 */
export function resolveNotificationTarget(
  n: Pick<AppNotification, 'link_path' | 'notification_type'>,
  role: OsRole,
  returnTo: string = NOTIFICATIONS_ROUTE,
): PushTarget {
  if (n.link_path) {
    const target = resolvePushLink(stripReturnTo(localizeLinkForRole(n.link_path, role)), returnTo, role);
    if (target) return target;
  }
  const fallback = resolveNotificationLink(n.notification_type, role);
  const base = fallback ?? { pathname: '/inbox', params: {} };
  return { pathname: base.pathname, params: { ...(base.params || {}), returnTo } };
}
