/** Типы единого chat sync orchestrator */

export type ChatSyncScope = 'all' | 'thread';

export type ChatSyncReason =
  | 'initial'
  | 'focus'
  | 'websocket'
  | 'manual'
  | 'offline_flush'
  | 'project_change'
  | 'app_foreground'
  | 'reconnect'
  | 'poll';

export type ChatSyncPriority = 'high' | 'normal' | 'low';

export type ChatSyncRequest = {
  scope: ChatSyncScope;
  threadId?: string;
  reason: ChatSyncReason;
  priority?: ChatSyncPriority;
};

/** `${userId}:${role}:${projectId}` — ответ применяется только при совпадении */
export type ChatSyncContextKey = string;

export type ChatSyncContext = {
  userId: string | null;
  role: string | null;
  projectId: string | null;
};

export type ChatSyncTransportArgs = {
  contextKey: ChatSyncContextKey;
  userId: string;
  role: string | null;
  projectId: string | null;
  signal: AbortSignal;
  sequence: number;
  reason: ChatSyncReason;
};

export type ChatSyncTransport = {
  /** Inbox + unread snapshot (+ tasks если project в контексте) */
  syncAll: (args: ChatSyncTransportArgs) => Promise<void>;
  /** Сообщения конкретного треда */
  syncThread: (args: ChatSyncTransportArgs & { threadId: string }) => Promise<void>;
};

export type ChatSyncClock = {
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (id: ReturnType<typeof setTimeout>) => void;
};

export type ChatSyncMetrics = {
  syncRequests: number;
  coalescedRequests: number;
  cancelledRequests: number;
  wsReconnects: number;
  reconciliationFailures: number;
  appliedResponses: number;
  droppedStaleResponses: number;
};

/**
 * Финальное состояние запроса синхронизации.
 * Промежуточные внутренние этапы (started/debounced) наружу не возвращаются:
 * вызывающий получает только фактический итог применения, пропуска или отмены.
 */
export type ChatSyncOutcome =
  | 'coalesced'
  | 'skipped_no_user'
  | 'skipped_unmounted'
  | 'applied'
  | 'dropped_stale_context'
  | 'dropped_stale_sequence'
  | 'cancelled'
  | 'failed';
