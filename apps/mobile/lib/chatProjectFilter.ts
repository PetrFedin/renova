/** Фильтр чатов по объектам — один, несколько или все */
import type { ChatThread } from '@/lib/api';
import { pluralizeRu } from './i18n/ruPlural';
import { RU_NOUN } from './i18n/ruCountLabels';

export type ChatProjectFilter = {
  /** null — все объекты; иначе только выбранные id */
  projectIds: string[] | null;
};

export const CHAT_FILTER_ALL: ChatProjectFilter = { projectIds: null };

export function normalizeChatProjectFilter(
  saved: ChatProjectFilter | null | undefined,
  availableIds: string[],
): ChatProjectFilter {
  if (!saved || saved.projectIds === null) return CHAT_FILTER_ALL;
  const ids = saved.projectIds.filter((id) => availableIds.includes(id));
  if (!ids.length) return CHAT_FILTER_ALL;
  if (ids.length === availableIds.length) return CHAT_FILTER_ALL;
  return { projectIds: ids };
}

function normChatTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Один чат на название внутри объекта — оставляем самый свежий */
export function dedupeChatThreadsByTitle(threads: ChatThread[]): ChatThread[] {
  const byKey = new Map<string, ChatThread>();
  for (const t of threads) {
    const key = `${t.project_id}::${normChatTitle(t.title)}`;
    const prev = byKey.get(key);
    if (!prev || (t.updated_at || '') > (prev.updated_at || '')) {
      byKey.set(key, t);
    }
  }
  return [...byKey.values()];
}

/** Только чаты с привязкой к объекту */
export function filterChatThreads(threads: ChatThread[], filter: ChatProjectFilter): ChatThread[] {
  const bound = dedupeChatThreadsByTitle(threads.filter((t) => !!t.project_id));
  if (filter.projectIds === null) return bound;
  if (!filter.projectIds.length) return [];
  const set = new Set(filter.projectIds);
  return bound.filter((t) => set.has(t.project_id));
}

export function chatProjectFilterLabel(
  filter: ChatProjectFilter,
  projects: { id: string; name: string }[],
): string {
  if (!projects.length) return 'Нет объектов';
  if (filter.projectIds === null || filter.projectIds.length >= projects.length) {
    return projects.length === 1 ? projects[0].name : `Все объекты (${projects.length})`;
  }
  if (filter.projectIds.length === 1) {
    return projects.find((p) => p.id === filter.projectIds![0])?.name || '1 объект';
  }
  const n = filter.projectIds.length;
  return `${n} ${pluralizeRu(n, RU_NOUN.project)}`;
}

export function isAllProjectsFilter(filter: ChatProjectFilter, projectCount: number): boolean {
  if (projectCount <= 0) return true;
  return filter.projectIds === null || filter.projectIds.length >= projectCount;
}

export function shouldGroupChatsByProject(filter: ChatProjectFilter, projectCount: number): boolean {
  if (projectCount <= 1) return false;
  if (filter.projectIds === null) return true;
  return filter.projectIds.length > 1;
}
