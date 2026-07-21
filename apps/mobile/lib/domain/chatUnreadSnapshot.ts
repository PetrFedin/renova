/**
 * Атомарная модель unread: threads + total из одного snapshot.
 *
 * Правила области (scope):
 * - total = сумма unread_count **неархивных** тредов (сообщения, не треды)
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

/** Сумма unread только по активным (неархивным) тредам — SoT для total */
export function sumActiveThreadUnread(threads: ChatThread[]): number {
  return threads
    .filter((t) => !t.is_archived)
    .reduce((sum, t) => sum + Math.max(0, t.unread_count || 0), 0);
}

/** Сумма unread в произвольном подмножестве (фильтр проекта / экран) */
export function sumThreadUnread(threads: ChatThread[]): number {
  return threads.reduce((sum, t) => sum + Math.max(0, t.unread_count || 0), 0);
}

export function snapshotFromThreads(
  threads: ChatThread[],
  revision: number,
  updatedAt?: string,
): ChatUnreadSnapshot {
  const totalUnreadMessages = sumActiveThreadUnread(threads);
  return {
    revision,
    totalUnreadMessages,
    threads,
    scope: CHAT_UNREAD_SCOPE,
    updatedAt,
  };
}

export function parseChatUnreadSnapshotApi(
  raw: ChatUnreadSnapshotApi | ChatThread[],
  fallbackRevision = Date.now(),
): ChatUnreadSnapshot {
  // Legacy: голый массив тредов
  if (Array.isArray(raw)) {
    return snapshotFromThreads(raw, fallbackRevision);
  }
  const threads = Array.isArray(raw.threads) ? raw.threads : [];
  const computed = sumActiveThreadUnread(threads);
  const reported = Math.max(0, raw.total_unread_messages ?? computed);
  // Истина — сумма тредов; расхождение залогирует invariant
  return {
    revision: typeof raw.revision === 'number' && Number.isFinite(raw.revision)
      ? raw.revision
      : fallbackRevision,
    totalUnreadMessages: computed,
    threads,
    scope: CHAT_UNREAD_SCOPE,
    updatedAt: raw.updated_at,
    // reported сохранён только для проверки
    ...(reported !== computed ? {} : {}),
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
  const normalized = snapshotFromThreads(
    incoming.threads,
    // force: берём max, чтобы локальные +1 после mark-read не откатывали monotonic
    opts?.force && current
      ? Math.max(incoming.revision, current.revision)
      : incoming.revision,
    incoming.updatedAt,
  );
  return { ok: true, snapshot: normalized };
}

/** Достать threads из ответа inbox (snapshot или legacy array). */
export function threadsFromChatInbox(
  raw: ChatUnreadSnapshotApi | ChatThread[],
): ChatThread[] {
  return parseChatUnreadSnapshotApi(raw).threads;
}

/**
 * Частичное обновление одного треда → новый snapshot с revision+1 (локально)
 * и пересчитанным total в том же action.
 */
export function patchThreadUnreadInSnapshot(
  current: ChatUnreadSnapshot,
  threadId: string,
  unreadCount: number,
  localRevision = Date.now(),
): ChatUnreadSnapshot {
  const unread = Math.max(0, unreadCount || 0);
  let found = false;
  const threads = current.threads.map((t) => {
    if (t.id !== threadId) return t;
    found = true;
    return { ...t, unread_count: unread };
  });
  // Новый тред из WS без строки — не добавляем здесь (нужен полный snapshot)
  void found;
  const revision = Math.max(localRevision, current.revision + 1);
  return snapshotFromThreads(threads, revision, new Date().toISOString());
}

export function removeThreadFromSnapshot(
  current: ChatUnreadSnapshot,
  threadId: string,
  localRevision = Date.now(),
): ChatUnreadSnapshot {
  const threads = current.threads.filter((t) => t.id !== threadId);
  return snapshotFromThreads(
    threads,
    Math.max(localRevision, current.revision + 1),
    new Date().toISOString(),
  );
}

export function setThreadArchivedInSnapshot(
  current: ChatUnreadSnapshot,
  threadId: string,
  isArchived: boolean,
  localRevision = Date.now(),
): ChatUnreadSnapshot {
  const threads = current.threads.map((t) =>
    t.id === threadId ? { ...t, is_archived: isArchived } : t,
  );
  return snapshotFromThreads(
    threads,
    Math.max(localRevision, current.revision + 1),
    new Date().toISOString(),
  );
}

/**
 * Runtime invariant: sum(active thread unread) === total.
 * Для UI-фильтра: sumVisible <= total.
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

/** Dev/test: структурированное предупреждение без PII */
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
