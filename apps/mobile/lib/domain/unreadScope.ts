/**
 * Явные области unread — каждый count обязан иметь UnreadScope.
 * Запрещены голые getUnread() без scope.
 *
 * Источник для global/project/filter: полный inbox snapshot (не paginated page).
 * Thread: unread_count конкретного треда.
 */

import type { ChatThread } from '@/lib/api';
import { sumActiveThreadUnread, sumThreadUnread } from './chatUnreadSnapshot';
import {
  CHAT_FILTER_ALL,
  type ChatProjectFilter,
  isAllProjectsFilter,
} from '../chatProjectFilter';
import { formatUnreadCount } from '../i18n/ruCountLabels';
import { pluralizeRu } from '../i18n/ruPlural';
import { RU_NOUN } from '../i18n/ruCountLabels';

export type UnreadScope =
  | { type: 'global' }
  | { type: 'project'; projectId: string }
  | { type: 'filter'; filterId: string }
  | { type: 'thread'; threadId: string };

export type UnreadCountResult = {
  count: number;
  scope: UnreadScope;
  /** Подпись области для UI */
  scopeLabel: string;
  /**
   * false — нельзя доверять (неполный paginated список).
   * UI должен показать loading/stale, не подставлять как истину.
   */
  reliable: boolean;
};

export type UnreadSelectSource = {
  /** Полный список тредов inbox (или заведомо полный subset) */
  threads: ChatThread[];
  /**
   * true только если threads — полный SoT для scope
   * (GET /chats/inbox snapshot, не страница listChats).
   */
  threadsComplete: boolean;
  /** Snapshot total — предпочтительнее пересчёта для global */
  globalTotal?: number;
};

/** Стабильный filterId для фильтра объектов / архива */
export function filterIdForChatUi(
  folder: 'active' | 'archive',
  projectFilter: ChatProjectFilter,
  projectCount: number,
): string {
  if (folder === 'archive') return 'archive';
  if (isAllProjectsFilter(projectFilter, projectCount)) return 'all';
  const ids = projectFilter.projectIds ?? [];
  if (ids.length === 1) return `project:${ids[0]}`;
  return `projects:${[...ids].sort().join(',')}`;
}

export function unreadScopeForChatList(opts: {
  folder: 'active' | 'archive';
  projectFilter: ChatProjectFilter;
  projectCount: number;
}): UnreadScope {
  const { folder, projectFilter, projectCount } = opts;
  if (folder === 'archive') return { type: 'filter', filterId: 'archive' };
  if (isAllProjectsFilter(projectFilter, projectCount)) return { type: 'global' };
  const ids = projectFilter.projectIds ?? [];
  if (ids.length === 1) return { type: 'project', projectId: ids[0] };
  return { type: 'filter', filterId: filterIdForChatUi(folder, projectFilter, projectCount) };
}

export function unreadScopeLabel(
  scope: UnreadScope,
  opts?: { projectName?: string },
): string {
  switch (scope.type) {
    case 'global':
      return 'все чаты';
    case 'project':
      return opts?.projectName ? `объект «${opts.projectName}»` : 'выбранный объект';
    case 'filter':
      if (scope.filterId === 'archive') return 'архив';
      if (scope.filterId === 'all') return 'все чаты';
      if (scope.filterId.startsWith('project:')) return opts?.projectName || 'выбранный объект';
      if (scope.filterId.startsWith('projects:')) return 'выбранные объекты';
      return 'текущий фильтр';
    case 'thread':
      return 'этот чат';
    default:
      return 'чат';
  }
}

/**
 * Единственный селектор unread — scope обязателен.
 * Не вызывайте без явной области.
 */
export function selectUnreadCount(
  scope: UnreadScope,
  source: UnreadSelectSource,
  labelOpts?: { projectName?: string },
): UnreadCountResult {
  const scopeLabel = unreadScopeLabel(scope, labelOpts);

  if (scope.type === 'thread') {
    const t = source.threads.find((x) => x.id === scope.threadId);
    if (!t && !source.threadsComplete) {
      return { count: 0, scope, scopeLabel, reliable: false };
    }
    return {
      count: Math.max(0, t?.unread_count || 0),
      scope,
      scopeLabel,
      reliable: Boolean(t) || source.threadsComplete,
    };
  }

  // local scopes требуют полный snapshot
  if (!source.threadsComplete) {
    return { count: 0, scope, scopeLabel, reliable: false };
  }

  if (scope.type === 'global') {
    const count = typeof source.globalTotal === 'number'
      ? Math.max(0, source.globalTotal)
      : sumActiveThreadUnread(source.threads);
    return { count, scope, scopeLabel, reliable: true };
  }

  if (scope.type === 'project') {
    const threads = source.threads.filter(
      (t) => t.project_id === scope.projectId && !t.is_archived,
    );
    return {
      count: sumThreadUnread(threads),
      scope,
      scopeLabel,
      reliable: true,
    };
  }

  // filter
  if (scope.filterId === 'archive') {
    const threads = source.threads.filter((t) => t.is_archived);
    return {
      count: sumThreadUnread(threads),
      scope,
      scopeLabel,
      reliable: true,
    };
  }
  if (scope.filterId === 'all') {
    return selectUnreadCount({ type: 'global' }, source, labelOpts);
  }
  if (scope.filterId.startsWith('project:')) {
    const projectId = scope.filterId.slice('project:'.length);
    return selectUnreadCount({ type: 'project', projectId }, source, labelOpts);
  }
  if (scope.filterId.startsWith('projects:')) {
    const ids = new Set(scope.filterId.slice('projects:'.length).split(',').filter(Boolean));
    const threads = source.threads.filter(
      (t) => ids.has(t.project_id) && !t.is_archived,
    );
    return {
      count: sumThreadUnread(threads),
      scope,
      scopeLabel,
      reliable: true,
    };
  }

  return { count: 0, scope, scopeLabel, reliable: false };
}

/**
 * Текст баннера: локальный vs глобальный без двух голых чисел рядом.
 */
export function formatScopedUnreadBanner(opts: {
  local: UnreadCountResult;
  global: UnreadCountResult;
}): string | null {
  const { local, global } = opts;
  if (!local.reliable || !global.reliable) return null;
  if (global.count <= 0 && local.count <= 0) return null;

  if (local.scope.type === 'global') {
    if (global.count <= 0) return null;
    return `Всего: ${formatUnreadCount(global.count)}`;
  }

  if (local.scope.type === 'filter' && local.scope.filterId === 'archive') {
    if (local.count <= 0) return null;
    return `В архиве: ${formatUnreadCount(local.count)}`;
  }

  // project / multi-filter
  if (local.count <= 0 && global.count > 0) {
    return `В ${local.scopeLabel}: нет непрочитанных (всего ${global.count})`;
  }
  if (local.count > 0) {
    return `В ${local.scopeLabel}: ${local.count} из ${global.count} ${pluralizeRu(global.count, RU_NOUN.unread)}`;
  }
  return null;
}

export function formatDockChatA11y(globalCount: number): string {
  const n = Math.max(0, globalCount);
  if (n <= 0) return 'Чаты';
  return `Чаты, ${formatUnreadCount(n)} во всех чатах`;
}

/** @deprecated используйте selectUnreadCount с явным scope */
export function assertUnreadScope(scope: UnreadScope | null | undefined): UnreadScope {
  if (!scope) {
    throw new Error('UnreadScope required: use { type: "global" } | project | filter | thread');
  }
  return scope;
}

export { CHAT_FILTER_ALL, isAllProjectsFilter };
