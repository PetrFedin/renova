/**
 * InboxCounters — семантика полей без смешивания единиц.
 * Run: npx tsx apps/mobile/lib/domain/inboxCounters.test.ts
 */
import type { InboxItem } from './buildInboxItems';
import {
  computeInboxCounters,
  deprecatedAttentionTotal,
  emptyInboxCounters,
  formatInboxCountersSubtitle,
  inboxActionItemTotal,
  inboxCountersFromApi,
  inboxCountersToApi,
  inboxCounterSummaryRows,
  normalizeCounter,
  reconcileDeprecatedAggregate,
} from './inboxCounters';
import { resolveHeaderMoreBadge, resolveInboxMenuBadgesFromCounters } from './headerChatBadges';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const chat: InboxItem = { id: 'chat', kind: 'chat', title: 'Чат', href: '/c', priority: 90 };
const pay = (id: string): InboxItem => ({ id, kind: 'payment', title: 'Счёт', href: '/p', priority: 85 });
const appr: InboxItem = {
  id: 'ap-1',
  kind: 'approval',
  title: 'С',
  approval: { id: '1', type: 'material', title: 'С', status: 'pending' },
  priority: 80,
};
const quality: InboxItem = { id: 'q1', kind: 'quality', title: 'Q', href: '/q', priority: 79, unitCount: 3 };
const stage: InboxItem = { id: 'st', kind: 'stage', title: 'Этап', href: '/s', priority: 92 };

// 1. одна категория
{
  const c = computeInboxCounters([pay('p1'), pay('p2')], 0);
  assert(c.paymentActions === 2, 'one cat: payments');
  assert(c.unreadMessages === 0 && c.activeTasks === 0, 'one cat: others 0');
  assert(c.totalActionGroups === 1, 'one cat: groups=1');
}

// 2. несколько категорий
{
  const c = computeInboxCounters([chat, pay('p1'), appr, quality, stage], 17);
  assert(c.unreadMessages === 17, 'multi: messages are count not threads');
  assert(c.paymentActions === 1, 'multi: payments');
  assert(c.pendingApprovals === 1, 'multi: approvals');
  assert(c.qualityActions === 3, 'multi: quality unitCount');
  assert(c.activeTasks === 1, 'multi: stage→activeTasks');
  assert(c.totalActionGroups === 5, 'multi: 5 groups');
  assert(deprecatedAttentionTotal(c) === 17 + 1 + 1 + 3 + 1, 'deprecated sum documented');
}

// 3. нулевые значения
{
  const z = emptyInboxCounters();
  assert(z.totalActionGroups === 0, 'zeros');
  assert(inboxCounterSummaryRows(z).length === 0, 'no summary rows');
  assert(formatInboxCountersSubtitle(z) === 'Все задачи проекта', 'empty subtitle');
  assert(normalizeCounter(-1) === 0 && normalizeCounter(Number.NaN) === 0, 'normalize');
}

// 4. повторное WS-событие (идемпотентный пересчёт)
{
  const items = [pay('p1'), stage];
  const a = computeInboxCounters(items, 4);
  const b = computeInboxCounters(items, 4);
  assert(JSON.stringify(a) === JSON.stringify(b), 'ws duplicate → same counters');
}

// 5. смена пользователя — полный reset модели
{
  const userA = computeInboxCounters([pay('p1')], 9);
  const userB = emptyInboxCounters();
  assert(userA.unreadMessages === 9 && userB.unreadMessages === 0, 'user switch clears');
}

// 6. смена проекта — пересчёт action, messages остаются отдельным полем
{
  const projectA = computeInboxCounters([stage, pay('p1')], 5);
  const projectB = computeInboxCounters([appr], 5);
  assert(projectA.unreadMessages === projectB.unreadMessages, 'project: messages global field');
  assert(projectA.paymentActions === 1 && projectB.paymentActions === 0, 'project: actions change');
  assert(projectB.pendingApprovals === 1, 'project B approvals');
}

// 7. смена роли — те же правила категорий
{
  const customer = computeInboxCounters([pay('p1'), quality], 2);
  const contractor = computeInboxCounters([stage], 2);
  assert(customer.paymentActions === 1 && contractor.activeTasks === 1, 'role categories');
  assert(customer.unreadMessages === contractor.unreadMessages, 'role: messages independent');
}

// 8. offline cache — грязные числа
{
  const fromCache = inboxCountersFromApi({
    unread_messages: '3' as unknown as number,
    active_tasks: -2,
    pending_approvals: Number.NaN,
    payment_actions: 1,
    quality_actions: 0,
  });
  assert(fromCache.unreadMessages === 3, 'offline string→3');
  assert(fromCache.activeTasks === 0 && fromCache.pendingApprovals === 0, 'offline dirty→0');
  assert(fromCache.paymentActions === 1, 'offline payment kept');
}

// 9. stale ответ API — structured побеждает; mismatch фиксируется
{
  const structured = computeInboxCounters([pay('p1'), stage], 10);
  const api = inboxCountersFromApi(inboxCountersToApi(structured));
  assert(api.unreadMessages === 10 && api.paymentActions === 1, 'api roundtrip');
  const { aggregateMismatch } = reconcileDeprecatedAggregate(structured, 999);
  assert(aggregateMismatch === true, 'stale aggregate mismatch');
  const ok = reconcileDeprecatedAggregate(structured, deprecatedAttentionTotal(structured));
  assert(ok.aggregateMismatch === false, 'matching aggregate');
}

// 10. несовпадение старого агрегата с новыми полями — UI не использует агрегат
{
  const c = computeInboxCounters([pay('p1'), pay('p2'), appr], 17);
  // Старый badge был бы 17+2+1=20; UI показывает раздельно
  assert(c.unreadMessages === 17, 'no mix: messages');
  assert(inboxActionItemTotal(c) === 3, 'no mix: actions only');
  assert(c.totalActionGroups === 3, 'groups not 20');
  const menu = resolveInboxMenuBadgesFromCounters(c);
  assert(menu.chat === 17 && menu.payments === 2 && menu.approvals === 1, 'menu labeled');
  assert(resolveHeaderMoreBadge(inboxActionItemTotal(c), 17)?.count === 3, 'More=actions not chat');
  assert(resolveHeaderMoreBadge(0, 17) === null, 'More hidden when only chat');
  assert(
    formatInboxCountersSubtitle(c) === 'Сообщения: 17 · Согласования: 1 · Платежи: 2',
    'subtitle labeled',
  );
}

console.log('inboxCounters.test OK');
