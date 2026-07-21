/**
 * Атомарная модель unread: threads + authoritative server total из одного snapshot.
 *
 * Правила области (scope):
 * - server snapshot: total_unread_messages — источник истины
 * - local mutations: total меняется на дельту затронутого треда, а не пересчитывается целиком
 * - архив: не входит в global total; карточка архива может показывать свой unread
 * - muted / closed: в модели нет — не учитываются
 * - фильтр проекта на UI не меняет global total (только видимую сумму карточек)
 */

import type { ChatThread } from '@/lib/api';

export type ChatUnreadScope = {
  /** Архивные чаты не входят в total_unread_messages */
  includeArchived: false;
  /** Muted в продукте нет */
  includeMuted: false;
  /** Считаем сообщения, не число тредов */
  unit: 'messages';
};

export const CHAT_UNREAD_SCOPE: ChatUnreadScope = {
  includeArchived: false,
  includeMuted: false,
  unit: 'messages',
};

export type ChatUnreadSnapshot = {
  revision: number;
  totalUnreadMessages: number;
  threads: ChatThread[];
  scope: ChatUnreadScope;
  /** ISO, опционально */
  updatedAt?: string;
};

export type ChatUnreadSnapshotApi = {
  revision: number;
  total_unread_messages: number;
  threads: ChatThread[];
  scope?: {
    include_archived?: boolean;
    include_muted?: boolean;
    unit?: string;
  };
  updated_at?: string;
};

function normalizeUnreadCount(value: unknown, fallback = 0): number {
  const candidate = typeof value === 'number' && Number.isFinite(value)
    ? value
    : fallback;
  return Math.max(0, Math.trunc(candidate));
}

function threadUnread(thread: ChatThread | undefined): number {
  return normalizeUnreadCount(thread?.unread_count);
}

function threadContribution(thread: ChatThread | undefined): number {
  return thread && !thread.is_archived ? threadUnread(thread) : 0;
}

/** Сумма unread только по активным (неархивным) тредам — invariant/legacy helper. */
export function sumActiveThreadUnread(threads: ChatThread[]): number {
  return threads
    .filter((t) => !t.is_archived)
    .reduce((sum, t) => sum + threadUnread(t), 0);
}

/** Сумма unread в произвольном подмножестве (фильтр проекта / экран). */
export function sumThreadUnread(threads: ChatThread[]): number {
  return threads.reduce((sum, t) => sum + threadUnread(t), 0);
}

/** Локальный snapshot без server total: total выводится из полного набора тредов. */
export function snapshotFromThreads(
  threads: ChatThread[],
  revision: number,
  updatedAt?: string,
): ChatUnreadSnapshot {
  return {
    revision,
    totalUnreadMessages: sumActiveThreadUnread(threads),
    threads,
    scope: CHAT_UNREAD_SCOPE,
    updatedAt,
  };
}

export function parseChatUnreadSnapshotApi(
  raw: ChatUnreadSnapshotApi | ChatThread[],
  fallbackRevision = Date.now(),
): ChatUnreadSnapshot {
  // Legacy: голый массив тредов не содержит authoritative total.
  if (Array.isArray(raw)) {
    return snapshotFromThreads(raw, fallbackRevision);
  }

  const threads = Array.isArray(raw.threads) ? raw.threads : [];
  const computedFallback = sumActiveThreadUnread(threads);
  return {
    revision: typeof raw.revision === 'number' && Number.isFinite(raw.revision)
      ? raw.revision
      : fallbackRevision,
    // Для нового API серверный total authoritative. Сумма тредов — только fallback/invariant.
    totalUnreadMessages: normalizeUnreadCount(raw.total_unread_messages, computedFallback),
    threads,
    scope: CHAT_UNREAD_SCOPE,
    updatedAt: raw.updated_at,
  };
}

export type ApplySnapshotResult =
  | { ok: true; snapshot: ChatUnreadSnapshot }
  | { ok: false; reason: 'stale_revision'; snapshot: ChatUnreadSnapshot };

/**
 * Применить snapshot целиком. Старый revision не перезаписывает новый.
 * `force` — ответ успешного GET/inbox (SoT сети); защита от out-of-order — loadGeneration в store.
 */
export function applyChatUnreadSnapshot(
  current: ChatUnreadSnapshot | null,
  incoming: ChatUnreadSnapshot,
  opts?: { force?: boolean },
): ApplySnapshotResult {
  if (!opts?.force && current && incoming.revision < current.revision) {
    return { ok: false, reason: 'stale_revision', snapshot: current };
  }

  const threads = Array.isArray(incoming.threads) ? incoming.threads : [];
  const normalized: ChatUnreadSnapshot = {
    revision: opts?.force && current
      ? Math.max(incoming.revision, current.revision)
      : incoming.revision,
    totalUnreadMessages: normalizeUnreadCount(
      incoming.totalUnreadMessages,
      sumActiveThreadUnread(threads),
    ),
    threads,
    scope: CHAT_UNREAD_SCOPE,
    updatedAt: incoming.updatedAt,
  };
  return { ok: true, snapshot: normalized };
}

/** Достать threads из ответа inbox (snapshot или legacy array). */
export function threadsFromChatInbox(
  raw: ChatUnreadSnapshotApi | ChatThread[],
): ChatThread[] {
  return parseChatUnreadSnapshotApi(raw).threads;
}

/**
 * Частичное локальное обновление одного треда.
 * Authoritative global total меняется только на дельту этого треда — так локальный
 * patch не уничтожает серверную информацию о тредах, отсутствующих в текущем массиве.
 */
export function patchThreadUnreadInSnapshot(
  current: ChatUnreadSnapshot,
  threadId: string,
  unreadCount: number,
  localRevision = Date.now(),
  authoritativeTotal?: number,
): ChatUnreadSnapshot {
  const unread = normalizeUnreadCount(unreadCount);
  const before = current.threads.find((t) => t.id === threadId);
  const threads = current.threads.map((t) =>
    t.id === threadId ? { ...t, unread_count: unread } : t,
  );
  const after = threads.find((t) => t.id === threadId);
  const delta = threadContribution(after) - threadContribution(before);
  const nextTotal = authoritativeTotal == null
    ? normalizeUnreadCount(current.totalUnreadMessages + delta)
    : normalizeUnreadCount(authoritativeTotal);

  return {
    revision: Math.max(localRevision, current.revision + 1),
    totalUnreadMessages: nextTotal,
    threads,
    scope: CHAT_UNREAD_SCOPE,
    updatedAt: new Date().toISOString(),
  };
}

export function removeThreadFromSnapshot(
  current: ChatUnreadSnapshot,
  threadId: string,
  localRevision = Date.now(),
): ChatUnreadSnapshot {
  const removed = current.threads.find((t) => t.id === threadId);
  return {
    revision: Math.max(localRevision, current.revision + 1),
    totalUnreadMessages: normalizeUnreadCount(
      current.totalUnreadMessages - threadContribution(removed),
    ),
    threads: current.threads.filter((t) => t.id !== threadId),
    scope: CHAT_UNREAD_SCOPE,
    updatedAt: new Date().toISOString(),
  };
}

export function setThreadArchivedInSnapshot(
  current: ChatUnreadSnapshot,
  threadId: string,
  isArchived: boolean,
  localRevision = Date.now(),
): ChatUnreadSnapshot {
  const before = current.threads.find((t) => t.id === threadId);
  const threads = current.threads.map((t) =>
    t.id === threadId ? { ...t, is_archived: isArchived } : t,
  );
  const after = threads.find((t) => t.id === threadId);
  return {
    revision: Math.max(localRevision, current.revision + 1),
    totalUnreadMessages: normalizeUnreadCount(
      current.totalUnreadMessages + threadContribution(after) - threadContribution(before),
    ),
    threads,
    scope: CHAT_UNREAD_SCOPE,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Runtime invariant: для полного атомарного snapshot сумма активных тредов равна total.
 * Расхождение не даёт клиенту права переписать authoritative server total — только логируется.
 */
export function checkUnreadInvariant(
  snapshot: ChatUnreadSnapshot,
  visibleThreads?: ChatThread[],
): { ok: boolean; sumActive: number; total: number; sumVisible?: number } {
  const sumActive = sumActiveThreadUnread(snapshot.threads);
  const total = snapshot.totalUnreadMessages;
  const sumVisible = visibleThreads ? sumThreadUnread(visibleThreads) : undefined;
  const ok = sumActive === total
    && (sumVisible === undefined || sumVisible <= total);
  return { ok, sumActive, total, sumVisible };
}

/** Dev/test: структурированное предупреждение без PII. */
export function warnUnreadInvariantIfBroken(
  snapshot: ChatUnreadSnapshot,
  visibleThreads?: ChatThread[],
  context = 'chatUnread',
): void {
  if (typeof __DEV__ !== 'undefined' && !__DEV__) return;
  const r = checkUnreadInvariant(snapshot, visibleThreads);
  if (r.ok) return;
  // eslint-disable-next-line no-console
  console.warn('[chat-unread-invariant]', {
    context,
    revision: snapshot.revision,
    sumActive: r.sumActive,
    total: r.total,
    sumVisible: r.sumVisible,
    threadCount: snapshot.threads.length,
    // без title / message text
  });
}
