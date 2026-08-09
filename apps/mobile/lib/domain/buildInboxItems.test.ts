import { api } from '@/lib/api';
import {
  buildInboxItemsWithHealth,
  inboxTotal,
  inboxAttentionBadge,
  inboxTaskBadge,
  inboxLinkItems,
  filterInboxForHero,
  type InboxItem,
} from './buildInboxItems';
import { selectConfirmedInboxSnapshot } from './inboxIntegrity';
import { resolveInboxNavigation } from './inboxNavigation';

let ok = true;
function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('FAIL', msg); ok = false; }
}

const items: InboxItem[] = [
  { id: 'chat', kind: 'chat', title: 'Чат', sub: '2 в чатах', href: '/chat', priority: 90 },
  { id: 'pay-1', kind: 'payment', title: 'Счёт 1', sub: '10 000 ₽', href: '/budget', priority: 85 },
  { id: 'pay-2', kind: 'payment', title: 'Счёт 2', sub: '20 000 ₽', href: '/budget', priority: 85 },
];

assert(inboxTotal(items, 0) === 3, 'total counts inbox rows');
assert(inboxAttentionBadge(items, 2) === 4, 'attention badge = tasks + unread messages');
assert(inboxTaskBadge(items) === 2, 'task badge excludes chat row');
assert(inboxAttentionBadge([{ id: 'chat', kind: 'chat', title: 'Чат', href: '/chat', priority: 90 }], 3) === 3, 'chat-only attention');
assert(inboxLinkItems(items, 'payment').length === 1, 'payment hero hides payment rows from link');
assert(inboxLinkItems(items, 'work').length === 3, 'non-payment hero keeps all rows');
assert(inboxTotal([], 4) === 4, 'chat unread when no chat item');
assert(
  filterInboxForHero(
    [{ id: 'acceptance', kind: 'acceptance', title: 'Приёмка', href: '/c', priority: 88 }],
    'accept',
  ).length === 0,
  'accept hero hides acceptance row',
);

// W77: warranty/change_order kinds count as tasks (not chat)
assert(
  inboxTaskBadge([
    { id: 'warranty-open', kind: 'warranty', title: 'Г', href: '/d', priority: 78 },
    { id: 'change-orders', kind: 'change_order', title: 'ДО', href: '/e', priority: 83 },
    { id: 'chat', kind: 'chat', title: 'Чат', href: '/c', priority: 90 },
  ]) === 2,
  'W77 task badge excludes chat, includes warranty+CO',
);

const hrefTarget = resolveInboxNavigation(items[1]!);
assert(hrefTarget.kind === 'href' && hrefTarget.href === '/budget', 'ordinary inbox row resolves to href navigation');

const approvalItem: InboxItem = {
  id: 'approval-material',
  kind: 'approval',
  title: 'Согласовать материал',
  priority: 95,
  approval: {
    id: 'material-1',
    type: 'material',
    title: 'Плитка',
    status: 'pending',
  },
};
const approvalTarget = resolveInboxNavigation(approvalItem);
assert(
  approvalTarget.kind === 'approval' && approvalTarget.approval.id === 'material-1',
  'approval inbox row resolves to approval payload instead of a fabricated href',
);

const priorConfirmed: InboxItem[] = [
  { id: 'confirmed-task', kind: 'work', title: 'Подтверждённая задача', href: '/work', priority: 70 },
];
const partialCandidate: InboxItem[] = [
  { id: 'partial-task', kind: 'payment', title: 'Частичный результат', href: '/budget', priority: 80 },
];
const degradedWithHistory = selectConfirmedInboxSnapshot({
  candidateItems: partialCandidate,
  previousItems: priorConfirmed,
  issueCount: 1,
  hasConfirmedSnapshot: true,
});
assert(
  degradedWithHistory.items === priorConfirmed && !degradedWithHistory.acceptedCandidate,
  'degraded reload preserves the last confirmed snapshot',
);
const degradedWithoutHistory = selectConfirmedInboxSnapshot({
  candidateItems: partialCandidate,
  previousItems: [],
  issueCount: 1,
  hasConfirmedSnapshot: false,
});
assert(
  degradedWithoutHistory.items.length === 0 && !degradedWithoutHistory.acceptedCandidate,
  'first degraded reload fails closed instead of publishing partial task rows',
);
const completeCandidate = selectConfirmedInboxSnapshot({
  candidateItems: partialCandidate,
  previousItems: priorConfirmed,
  issueCount: 0,
  hasConfirmedSnapshot: true,
});
assert(
  completeCandidate.items === partialCandidate && completeCandidate.acceptedCandidate,
  'complete reload replaces the confirmed snapshot',
);

async function testBuildHealth() {
  const mutableApi = api as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  const mocks: Record<string, (...args: unknown[]) => Promise<unknown>> = {
    listPayments: async () => [],
    approvalHub: async () => ({ items: [] }),
    acceptancesPendingCount: async () => ({ count: 0 }),
    getActiveWorkSchedule: async () => null,
    listIssues: async () => [],
    listMaterialPicks: async () => [],
    selectionsPendingCount: async () => ({ count: 0 }),
    listChangeOrders: async () => [],
    listWarrantyClaims: async () => ({ open: 0, overdue: 0 }),
    listProjectDocuments: async () => ({ items: [] }),
    listWorkOrders: async () => [],
  };
  const originals = new Map<string, (...args: unknown[]) => Promise<unknown>>();

  for (const [key, value] of Object.entries(mocks)) {
    originals.set(key, mutableApi[key]!);
    mutableApi[key] = value;
  }

  try {
    const complete = await buildInboxItemsWithHealth({
      userId: 'user-1',
      projectId: 'project-1',
      role: 'customer',
      chatUnread: 0,
    });
    assert(complete.health === 'complete', 'all successful sources produce complete health');
    assert(complete.issues.length === 0, 'complete inbox has no source issues');
    assert(complete.items.length === 0, 'legitimate empty source data remains a true empty inbox');

    mutableApi.listPayments = async () => { throw new Error('payments unavailable'); };
    const degraded = await buildInboxItemsWithHealth({
      userId: 'user-1',
      projectId: 'project-1',
      role: 'customer',
      chatUnread: 0,
    });
    assert(degraded.health === 'degraded', 'one failed source makes the aggregate degraded');
    assert(
      degraded.issues.some((issue) => issue.projectId === 'project-1' && issue.source === 'payments'),
      'degraded result identifies the failed source and project',
    );
    assert(degraded.items.length === 0, 'failed source can no longer masquerade as authoritative empty success');
  } finally {
    for (const [key, value] of originals) mutableApi[key] = value;
  }
}

void testBuildHealth()
  .then(() => {
    if (!ok) process.exit(1);
    console.log('buildInboxItems.test OK');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
