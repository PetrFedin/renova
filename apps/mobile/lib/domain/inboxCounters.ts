/**
 * Структурированные счётчики «Входящих».
 * Разные единицы (сообщения / задачи / оплаты…) никогда не складываются в одно необъяснимое число.
 */

import type { InboxItem } from './buildInboxItems';

export type InboxCounters = {
  /** Непрочитанные сообщения (штуки), не число тредов */
  unreadMessages: number;
  /** Задачи/этапы/работы, требующие действия (не approval/payment/quality) */
  activeTasks: number;
  /** Отдельные объекты согласования */
  pendingApprovals: number;
  /** Платежи, требующие действия */
  paymentActions: number;
  /** Замечания / качество / гарантия, требующие действия */
  qualityActions: number;
  /**
   * Число категорий с активностью (0–5).
   * Допустимо как «сколько типов внимания», не как сумма сущностей.
   */
  totalActionGroups: number;
};

export type InboxCountersApiV1 = {
  unread_messages: number;
  active_tasks: number;
  pending_approvals: number;
  payment_actions: number;
  quality_actions: number;
  total_action_groups: number;
  /** @deprecated сумма разных единиц — не использовать в UI */
  deprecated_attention_total?: number;
};

const APPROVAL_KINDS = new Set([
  'approval',
  'change_order',
  'estimate',
  'selection',
  'material',
  'schedule',
  'document',
]);

const PAYMENT_KINDS = new Set(['payment']);
const QUALITY_KINDS = new Set(['quality', 'warranty']);
/** chat учитывается только через unreadMessages */
const SKIP_KINDS = new Set(['chat']);

export function emptyInboxCounters(): InboxCounters {
  return {
    unreadMessages: 0,
    activeTasks: 0,
    pendingApprovals: 0,
    paymentActions: 0,
    qualityActions: 0,
    totalActionGroups: 0,
  };
}

export function normalizeCounter(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.trunc(n);
}

function unitOf(item: InboxItem): number {
  const raw = (item as { unitCount?: number }).unitCount;
  if (raw == null) return 1;
  return Math.max(1, normalizeCounter(raw) || 1);
}

function recountGroups(c: Omit<InboxCounters, 'totalActionGroups'>): number {
  return (
    Number(c.unreadMessages > 0)
    + Number(c.activeTasks > 0)
    + Number(c.pendingApprovals > 0)
    + Number(c.paymentActions > 0)
    + Number(c.qualityActions > 0)
  );
}

/**
 * Собирает счётчики из строк inbox + числа непрочитанных сообщений.
 * Каждая строка попадает ровно в одну категорию (кроме chat-строки).
 */
export function computeInboxCounters(
  items: InboxItem[],
  unreadMessages: number,
): InboxCounters {
  let activeTasks = 0;
  let pendingApprovals = 0;
  let paymentActions = 0;
  let qualityActions = 0;

  for (const item of items) {
    const kind = item.kind;
    if (SKIP_KINDS.has(kind)) continue;
    const n = unitOf(item);
    if (PAYMENT_KINDS.has(kind)) {
      paymentActions += n;
      continue;
    }
    if (QUALITY_KINDS.has(kind)) {
      qualityActions += n;
      continue;
    }
    if (APPROVAL_KINDS.has(kind)) {
      pendingApprovals += n;
      continue;
    }
    activeTasks += n;
  }

  const base = {
    unreadMessages: normalizeCounter(unreadMessages),
    activeTasks: normalizeCounter(activeTasks),
    pendingApprovals: normalizeCounter(pendingApprovals),
    paymentActions: normalizeCounter(paymentActions),
    qualityActions: normalizeCounter(qualityActions),
  };

  return {
    ...base,
    totalActionGroups: recountGroups(base),
  };
}

/** Сумма action-строк без сообщений (для жёлтого badge «задачи», не смешивая с chat) */
export function inboxActionItemTotal(c: InboxCounters): number {
  return c.activeTasks + c.pendingApprovals + c.paymentActions + c.qualityActions;
}

/**
 * @deprecated Складывает сообщения и задачи — запрещено для UI badge.
 * Оставлено для тестов миграции / сравнения со старым агрегатом.
 */
export function deprecatedAttentionTotal(c: InboxCounters): number {
  return c.unreadMessages + inboxActionItemTotal(c);
}

export function inboxCountersToApi(c: InboxCounters): InboxCountersApiV1 {
  return {
    unread_messages: c.unreadMessages,
    active_tasks: c.activeTasks,
    pending_approvals: c.pendingApprovals,
    payment_actions: c.paymentActions,
    quality_actions: c.qualityActions,
    total_action_groups: c.totalActionGroups,
    deprecated_attention_total: deprecatedAttentionTotal(c),
  };
}

export function inboxCountersFromApi(raw: Partial<InboxCountersApiV1> | null | undefined): InboxCounters {
  const c = {
    unreadMessages: normalizeCounter(raw?.unread_messages),
    activeTasks: normalizeCounter(raw?.active_tasks),
    pendingApprovals: normalizeCounter(raw?.pending_approvals),
    paymentActions: normalizeCounter(raw?.payment_actions),
    qualityActions: normalizeCounter(raw?.quality_actions),
  };
  return { ...c, totalActionGroups: recountGroups(c) };
}

/**
 * Если пришёл только старый агрегат без разбивки — не угадываем категории.
 * Кладём агрегат в unreadMessages только когда явно сказано, иначе 0 + флаг mismatch.
 */
export function reconcileDeprecatedAggregate(
  structured: InboxCounters,
  deprecatedTotal: number | undefined,
): { counters: InboxCounters; aggregateMismatch: boolean } {
  if (deprecatedTotal == null || !Number.isFinite(deprecatedTotal)) {
    return { counters: structured, aggregateMismatch: false };
  }
  const expected = deprecatedAttentionTotal(structured);
  const dep = normalizeCounter(deprecatedTotal);
  return {
    counters: structured,
    aggregateMismatch: dep !== expected,
  };
}

/** Подписи для экрана «Входящие» — только категории > 0 */
export function inboxCounterSummaryRows(c: InboxCounters): Array<{ key: keyof InboxCounters; label: string; count: number }> {
  const rows: Array<{ key: keyof InboxCounters; label: string; count: number }> = [
    { key: 'unreadMessages', label: 'Сообщения', count: c.unreadMessages },
    { key: 'activeTasks', label: 'Задачи', count: c.activeTasks },
    { key: 'pendingApprovals', label: 'Согласования', count: c.pendingApprovals },
    { key: 'paymentActions', label: 'Платежи', count: c.paymentActions },
    { key: 'qualityActions', label: 'Качество', count: c.qualityActions },
  ];
  return rows.filter((r) => r.count > 0);
}

export function formatInboxCountersSubtitle(c: InboxCounters): string {
  const parts = inboxCounterSummaryRows(c).map((r) => `${r.label}: ${r.count}`);
  if (!parts.length) return 'Все задачи проекта';
  return parts.join(' · ');
}
