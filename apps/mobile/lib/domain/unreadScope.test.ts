/**
 * UnreadScope selectors.
 * Run: npx tsx apps/mobile/lib/domain/unreadScope.test.ts
 */
import type { ChatThread } from '../api/types/chat';
import {
  formatScopedUnreadBanner,
  selectUnreadCount,
  unreadScopeForChatList,
  type UnreadScope,
} from './unreadScope';
import { CHAT_FILTER_ALL } from '../chatProjectFilter';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const t = (
  id: string,
  unread: number,
  project: string,
  archived = false,
): ChatThread => ({
  id,
  project_id: project,
  title: id,
  topic: null,
  updated_at: '2024-01-01T00:00:00Z',
  last_message: null,
  unread_count: unread,
  is_archived: archived,
});

const threads = [
  t('a', 3, 'p1'),
  t('b', 5, 'p2'),
  t('c', 2, 'p1', true),
  t('d', 0, 'p3'),
];
// global active = 3+5 = 8
const source = { threads, threadsComplete: true, globalTotal: 8 };

// global 8, project 3
{
  const g = selectUnreadCount({ type: 'global' }, source);
  const p = selectUnreadCount({ type: 'project', projectId: 'p1' }, source);
  assert(g.count === 8 && p.count === 3, 'global 8 project 3');
  const banner = formatScopedUnreadBanner({ local: p, global: g });
  assert(banner != null && banner.includes('3 из 8'), `banner ${banner}`);
}

// global 8, filter 2 projects
{
  const f = selectUnreadCount(
    { type: 'filter', filterId: 'projects:p1,p3' },
    source,
  );
  // p1 active 3 + p3 active 0 = 3
  assert(f.count === 3, 'multi filter');
  const onlyP2 = selectUnreadCount(
    { type: 'filter', filterId: 'projects:p2' },
    source,
  );
  assert(onlyP2.count === 5, 'filter p2');
}

// другой проект
{
  const p2 = selectUnreadCount({ type: 'project', projectId: 'p2' }, source);
  assert(p2.count === 5, 'other project');
}

// архивный фильтр
{
  const arch = selectUnreadCount({ type: 'filter', filterId: 'archive' }, source);
  assert(arch.count === 2, 'archive unread');
  const scope = unreadScopeForChatList({
    folder: 'archive',
    projectFilter: CHAT_FILTER_ALL,
    projectCount: 3,
  });
  assert(scope.type === 'filter' && scope.filterId === 'archive', 'archive scope');
}

// очищение фильтра → global
{
  const scope = unreadScopeForChatList({
    folder: 'active',
    projectFilter: CHAT_FILTER_ALL,
    projectCount: 3,
  });
  assert(scope.type === 'global', 'clear filter → global');
  const g = selectUnreadCount(scope, source);
  assert(g.count === 8, 'cleared still global 8');
}

// pagination — неполный список
{
  const page = { threads: threads.slice(0, 1), threadsComplete: false, globalTotal: 8 };
  const local = selectUnreadCount({ type: 'project', projectId: 'p1' }, page);
  assert(!local.reliable && local.count === 0, 'paginated unreliable');
  const globalStill = selectUnreadCount({ type: 'global' }, {
    threads: [],
    threadsComplete: true,
    globalTotal: 8,
  });
  assert(globalStill.count === 8 && globalStill.reliable, 'global from total meta');
}

// offline cache complete snapshot
{
  const cached = selectUnreadCount({ type: 'project', projectId: 'p1' }, {
    threads,
    threadsComplete: true,
    globalTotal: 8,
  });
  assert(cached.reliable && cached.count === 3, 'offline complete ok');
}

// WS вне текущего проекта — global растёт, local project нет
{
  const after = {
    threads: [t('a', 3, 'p1'), t('b', 6, 'p2')], // p2 +1
    threadsComplete: true,
    globalTotal: 9,
  };
  const local = selectUnreadCount({ type: 'project', projectId: 'p1' }, after);
  const global = selectUnreadCount({ type: 'global' }, after);
  assert(local.count === 3 && global.count === 9, 'ws outside project');
}

// смена роли — scope тот же, данные от user snapshot
{
  const scope: UnreadScope = { type: 'global' };
  assert(selectUnreadCount(scope, source).count === 8, 'role-agnostic count');
}

// удаление проекта — пустой project scope
{
  const gone = selectUnreadCount({ type: 'project', projectId: 'deleted' }, source);
  assert(gone.count === 0 && gone.reliable, 'deleted project');
}

// thread scope
{
  const th = selectUnreadCount({ type: 'thread', threadId: 'a' }, source);
  assert(th.count === 3 && th.scopeLabel === 'этот чат', 'thread');
}

// filter change: global неизменен
{
  const g1 = selectUnreadCount({ type: 'global' }, source);
  const local = selectUnreadCount({ type: 'project', projectId: 'p2' }, source);
  const g2 = selectUnreadCount({ type: 'global' }, source);
  assert(g1.count === g2.count && local.count === 5, 'filter change keeps global');
}

console.log('unreadScope.test OK');
