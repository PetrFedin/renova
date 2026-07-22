/**
 * Нормализация входящего сообщения: dedupe по messageId,
 * решение bump unread / mark-read в одной логической транзакции.
 */
import {
  isActivelyReadingThread,
  type ActiveThreadContext,
} from './activeThreadContext';
import { rememberAuthoritativeUnreadTotal } from './chatUnreadSnapshot';

export type IncomingChatMessageEvent = {
  messageId: string;
  threadId: string;
  /** Сообщение отправил текущий пользователь */
  fromSelf?: boolean;
  createdAt?: string | null;
};

export type IncomingMessageDecision = {
  /** false — дубликат / пустой id, не менять store */
  accept: boolean;
  /** Увеличить unread треда (и total) */
  bumpUnread: boolean;
  /** Отправить read cursor на сервер */
  shouldMarkRead: boolean;
  /** Причина для тестов/метрик (без PII) */
  reason:
    | 'applied_bump'
    | 'applied_suppress'
    | 'duplicate'
    | 'from_self'
    | 'missing_id';
};

const seen = new Map<string, number>();
const SEEN_TTL_MS = 10 * 60_000;
const SEEN_MAX = 500;

function pruneSeen(now: number) {
  if (seen.size <= SEEN_MAX) return;
  for (const [id, at] of seen) {
    if (now - at > SEEN_TTL_MS) seen.delete(id);
  }
  while (seen.size > SEEN_MAX) {
    const first = seen.keys().next().value;
    if (first == null) break;
    seen.delete(first);
  }
}

/** Сброс dedupe (смена пользователя / тесты) */
export function clearIncomingMessageDedupe(): void {
  seen.clear();
}

export function hasSeenIncomingMessage(messageId: string): boolean {
  return seen.has(messageId);
}

/**
 * Решить, как применить входящее сообщение к unread.
 * Вызывать до мутации snapshot — результат применяют атомарно в store.
 */
export function decideIncomingChatMessage(opts: {
  event: IncomingChatMessageEvent;
  active: ActiveThreadContext;
  now?: number;
}): IncomingMessageDecision {
  const { event, active } = opts;
  const now = opts.now ?? Date.now();
  const id = (event.messageId || '').trim();
  if (!id) {
    return {
      accept: false,
      bumpUnread: false,
      shouldMarkRead: false,
      reason: 'missing_id',
    };
  }

  if (seen.has(id)) {
    return {
      accept: false,
      bumpUnread: false,
      shouldMarkRead: false,
      reason: 'duplicate',
    };
  }
  seen.set(id, now);
  pruneSeen(now);

  if (event.fromSelf) {
    return {
      accept: true,
      bumpUnread: false,
      shouldMarkRead: false,
      reason: 'from_self',
    };
  }

  const reading = isActivelyReadingThread(active, event.threadId);
  if (reading) {
    return {
      accept: true,
      bumpUnread: false,
      shouldMarkRead: true,
      reason: 'applied_suppress',
    };
  }

  return {
    accept: true,
    bumpUnread: true,
    shouldMarkRead: false,
    reason: 'applied_bump',
  };
}

function normalizeUnread(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : 0;
}

/**
 * Применить серверный inbox snapshot: обнулить unread активного
 * читаемого треда в той же транзакции (без визуального 0→N→0).
 *
 * Важно: server total authoritative. Поэтому clamp вычитает только вклад
 * активного треда из server total, а не пересчитывает total по видимому массиву.
 * `recomputeTotal` оставлен только как fallback для legacy snapshot без total.
 */
export function clampSnapshotForActiveRead<T extends {
  threads: Array<{ id: string; unread_count?: number; is_archived?: boolean }>;
  totalUnreadMessages?: number;
}>(
  snapshot: T,
  active: ActiveThreadContext,
  recomputeTotal?: (threads: T['threads']) => number,
): T & { totalUnreadMessages?: number } {
  const tid = active.threadId;
  if (!tid || !isActivelyReadingThread(active, tid)) {
    return snapshot;
  }

  const activeThread = snapshot.threads.find((t) => t.id === tid);
  const activeContribution = activeThread && !activeThread.is_archived
    ? normalizeUnread(activeThread.unread_count)
    : 0;
  const threads = snapshot.threads.map((t) =>
    (t.id === tid ? { ...t, unread_count: 0 } : t),
  );
  const currentTotal = typeof snapshot.totalUnreadMessages === 'number'
    && Number.isFinite(snapshot.totalUnreadMessages)
    ? normalizeUnread(snapshot.totalUnreadMessages)
    : normalizeUnread(recomputeTotal?.(snapshot.threads));
  const totalUnreadMessages = Math.max(0, currentTotal - activeContribution);

  // Переходные call sites могут восстановить snapshot из массива threads.
  // Сохраняем authoritative clamped total вместе с новым массивом.
  rememberAuthoritativeUnreadTotal(threads, totalUnreadMessages);

  return {
    ...snapshot,
    threads,
    totalUnreadMessages,
  };
}
