/**
 * Единый orchestration layer для sync чатов.
 * Coalesce / AbortController / sequence / context key / WS debounce / poll backoff.
 */
import { buildChatSyncContextKey, isLoggedInContext } from './contextKey';
import { createEmptyMetrics, snapshotMetrics } from './metrics';
import type {
  ChatSyncClock,
  ChatSyncContext,
  ChatSyncContextKey,
  ChatSyncMetrics,
  ChatSyncOutcome,
  ChatSyncPriority,
  ChatSyncReason,
  ChatSyncRequest,
  ChatSyncTransport,
} from './types';

const PRIORITY_RANK: Record<ChatSyncPriority, number> = {
  low: 1,
  normal: 2,
  high: 3,
};

const WS_DEBOUNCE_MS = 150;
const POLL_BASE_MS = 12_000;
const POLL_MAX_MS = 60_000;
const POLL_WHEN_WS_MS = 60_000;

type CoalesceKey = string;

type PendingEntry = {
  request: Required<Pick<ChatSyncRequest, 'scope' | 'reason'>> & {
    threadId?: string;
    priority: ChatSyncPriority;
  };
  resolve: (outcome: ChatSyncOutcome) => void;
  promise: Promise<ChatSyncOutcome>;
};

type InflightEntry = {
  sequence: number;
  contextKey: ChatSyncContextKey;
  coalesceKey: CoalesceKey;
  controller: AbortController;
  priority: ChatSyncPriority;
  promise: Promise<ChatSyncOutcome>;
};

export type ChatSyncOrchestratorOptions = {
  transport: ChatSyncTransport;
  clock?: ChatSyncClock;
  wsDebounceMs?: number;
  pollBaseMs?: number;
  pollMaxMs?: number;
  /** Две вкладки web: BroadcastChannel */
  enableBroadcast?: boolean;
  broadcastFactory?: () => { postMessage: (data: unknown) => void; onmessage: ((ev: { data: unknown }) => void) | null; close: () => void } | null;
};

function defaultClock(): ChatSyncClock {
  return {
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
  };
}

function coalesceKey(scope: string, threadId: string | undefined, contextKey: string): CoalesceKey {
  return `${scope}:${threadId ?? '_'}:${contextKey}`;
}

export class ChatSyncOrchestrator {
  private transport: ChatSyncTransport;
  private clock: ChatSyncClock;
  private wsDebounceMs: number;
  private pollBaseMs: number;
  private pollMaxMs: number;

  private context: ChatSyncContext = { userId: null, role: null, projectId: null };
  private contextKey: ChatSyncContextKey = buildChatSyncContextKey(this.context);
  private sequence = 0;
  private latestAppliedByScope = new Map<string, number>();

  private pending = new Map<CoalesceKey, PendingEntry>();
  private inflight = new Map<CoalesceKey, InflightEntry>();
  private wsTimers = new Map<CoalesceKey, ReturnType<typeof setTimeout>>();

  private mounted = true;
  private inboxWsConnected = false;
  private sawInboxWs = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private pollIntervalMs: number;
  private pollFailures = 0;

  private metrics = createEmptyMetrics();
  private broadcast: ReturnType<NonNullable<ChatSyncOrchestratorOptions['broadcastFactory']>> = null;

  constructor(opts: ChatSyncOrchestratorOptions) {
    this.transport = opts.transport;
    this.clock = opts.clock ?? defaultClock();
    this.wsDebounceMs = opts.wsDebounceMs ?? WS_DEBOUNCE_MS;
    this.pollBaseMs = opts.pollBaseMs ?? POLL_BASE_MS;
    this.pollMaxMs = opts.pollMaxMs ?? POLL_MAX_MS;
    this.pollIntervalMs = this.pollBaseMs;

    if (opts.enableBroadcast) {
      const factory = opts.broadcastFactory ?? defaultBroadcastFactory;
      this.broadcast = factory();
      if (this.broadcast) {
        this.broadcast.onmessage = (ev) => {
          const data = ev.data as { type?: string; contextKey?: string } | null;
          if (!data || data.type !== 'invalidate') return;
          if (data.contextKey && data.contextKey !== this.contextKey) return;
          void this.requestSync({
            scope: 'all',
            reason: 'manual',
            priority: 'low',
          });
        };
      }
    }
  }

  getMetrics(): ChatSyncMetrics {
    return snapshotMetrics(this.metrics);
  }

  getContextKey(): ChatSyncContextKey {
    return this.contextKey;
  }

  getContext(): ChatSyncContext {
    return { ...this.context };
  }

  isInboxWsConnected(): boolean {
    return this.inboxWsConnected;
  }

  /** Обновить контекст; при смене — отменить inflight и сбросить pending */
  setContext(next: ChatSyncContext): void {
    const key = buildChatSyncContextKey(next);
    if (key === this.contextKey) {
      this.context = { ...next };
      return;
    }
    this.cancelAll('context_change');
    this.context = { ...next };
    this.contextKey = key;
    this.pollFailures = 0;
    this.pollIntervalMs = this.pollBaseMs;
    if (isLoggedInContext(this.context)) {
      this.reschedulePoll();
    } else {
      this.stopPoll();
    }
  }

  /** Logout / unmount корня — не применять ответы */
  logout(): void {
    this.setContext({ userId: null, role: null, projectId: null });
    this.cancelAll('logout');
  }

  setMounted(mounted: boolean): void {
    this.mounted = mounted;
    if (!mounted) this.cancelAll('unmount');
  }

  setTransport(transport: ChatSyncTransport): void {
    this.transport = transport;
  }

  /**
   * Состояние inbox WebSocket.
   * connected → редкий poll; disconnect → fallback poll + backoff.
   * reconnect (false→true) → один reconciliation.
   */
  setInboxWsConnected(connected: boolean): void {
    const was = this.inboxWsConnected;
    this.inboxWsConnected = connected;
    if (!was && connected) {
      if (this.sawInboxWs) this.metrics.wsReconnects += 1;
      this.sawInboxWs = true;
      this.pollFailures = 0;
      this.pollIntervalMs = POLL_WHEN_WS_MS;
      void this.requestSync({ scope: 'all', reason: 'reconnect', priority: 'high' });
    } else if (was && !connected) {
      this.pollIntervalMs = this.pollBaseMs;
    } else if (connected) {
      this.pollIntervalMs = POLL_WHEN_WS_MS;
    }
    this.reschedulePoll();
  }

  /** Нормализованное inbox WS-событие → debounced sync (не полный reload на каждое) */
  onInboxWsEvent(): void {
    void this.requestSync({ scope: 'all', reason: 'websocket', priority: 'normal' });
  }

  /** Thread WS: локальный apply предпочтительнее; иначе debounced thread sync */
  onThreadWsEvent(threadId: string): void {
    void this.requestSync({
      scope: 'thread',
      threadId,
      reason: 'websocket',
      priority: 'normal',
    });
  }

  /** Один reconciliation после offline flush */
  reconcileAfterOfflineFlush(): Promise<ChatSyncOutcome> {
    return this.requestSync({
      scope: 'all',
      reason: 'offline_flush',
      priority: 'high',
    });
  }

  requestSync(req: ChatSyncRequest): Promise<ChatSyncOutcome> {
    this.metrics.syncRequests += 1;

    if (!this.mounted) {
      return Promise.resolve('skipped_unmounted');
    }
    if (!isLoggedInContext(this.context)) {
      return Promise.resolve('skipped_no_user');
    }

    const priority = req.priority ?? defaultPriority(req.reason);
    const key = coalesceKey(req.scope, req.threadId, this.contextKey);

    // Debounce частых WS
    if (req.reason === 'websocket') {
      return this.enqueueDebounced(key, { ...req, priority });
    }

    return this.enqueueImmediate(key, { ...req, priority });
  }

  dispose(): void {
    this.setMounted(false);
    this.stopPoll();
    for (const t of this.wsTimers.values()) this.clock.clearTimeout(t);
    this.wsTimers.clear();
    this.broadcast?.close();
    this.broadcast = null;
  }

  private enqueueDebounced(
    key: CoalesceKey,
    req: ChatSyncRequest & { priority: ChatSyncPriority },
  ): Promise<ChatSyncOutcome> {
    const existingTimer = this.wsTimers.get(key);
    if (existingTimer) {
      this.clock.clearTimeout(existingTimer);
      this.metrics.coalescedRequests += 1;
    }

    let resolve!: (o: ChatSyncOutcome) => void;
    const promise = new Promise<ChatSyncOutcome>((r) => {
      resolve = r;
    });

    // Склеиваем с уже ожидающим pending
    const prev = this.pending.get(key);
    if (prev) {
      this.metrics.coalescedRequests += 1;
      prev.request.priority = maxPriority(prev.request.priority, req.priority);
      const prevResolve = prev.resolve;
      prev.resolve = (o) => {
        prevResolve(o);
        resolve(o);
      };
    } else {
      this.pending.set(key, {
        request: {
          scope: req.scope,
          threadId: req.threadId,
          reason: req.reason,
          priority: req.priority,
        },
        resolve,
        promise,
      });
    }

    const timer = this.clock.setTimeout(() => {
      this.wsTimers.delete(key);
      void this.flushPending(key);
    }, this.wsDebounceMs);
    this.wsTimers.set(key, timer);

    return this.pending.get(key)!.promise;
  }

  private enqueueImmediate(
    key: CoalesceKey,
    req: ChatSyncRequest & { priority: ChatSyncPriority },
  ): Promise<ChatSyncOutcome> {
    const inflight = this.inflight.get(key);
    if (inflight) {
      // High отменяет более слабый inflight
      if (PRIORITY_RANK[req.priority] > PRIORITY_RANK[inflight.priority]) {
        inflight.controller.abort();
        this.metrics.cancelledRequests += 1;
        this.inflight.delete(key);
      } else {
        // Trailing coalesce после текущего
        this.metrics.coalescedRequests += 1;
        return this.mergePending(key, req);
      }
    }

    const pending = this.pending.get(key);
    if (pending) {
      this.metrics.coalescedRequests += 1;
      pending.request.priority = maxPriority(pending.request.priority, req.priority);
      if (PRIORITY_RANK[req.priority] >= PRIORITY_RANK[pending.request.priority]) {
        pending.request.reason = req.reason;
      }
      return pending.promise;
    }

    return this.startFetch(key, req);
  }

  private mergePending(
    key: CoalesceKey,
    req: ChatSyncRequest & { priority: ChatSyncPriority },
  ): Promise<ChatSyncOutcome> {
    const existing = this.pending.get(key);
    if (existing) {
      existing.request.priority = maxPriority(existing.request.priority, req.priority);
      return existing.promise;
    }
    let resolve!: (o: ChatSyncOutcome) => void;
    const promise = new Promise<ChatSyncOutcome>((r) => {
      resolve = r;
    });
    this.pending.set(key, {
      request: {
        scope: req.scope,
        threadId: req.threadId,
        reason: req.reason,
        priority: req.priority,
      },
      resolve,
      promise,
    });
    // Запустится в finally inflight
    const inflight = this.inflight.get(key);
    if (inflight) {
      void inflight.promise.finally(() => {
        void this.flushPending(key);
      });
    }
    return promise;
  }

  private flushPending(key: CoalesceKey): Promise<ChatSyncOutcome> {
    const pending = this.pending.get(key);
    if (!pending) return Promise.resolve('coalesced');
    this.pending.delete(key);
    if (this.inflight.has(key)) {
      // Вернём в pending — дождёмся конца inflight
      this.pending.set(key, pending);
      return pending.promise;
    }
    const run = this.startFetch(key, pending.request);
    void run.then((o) => pending.resolve(o));
    return pending.promise;
  }

  private startFetch(
    key: CoalesceKey,
    req: {
      scope: 'all' | 'thread';
      threadId?: string;
      reason: ChatSyncReason;
      priority: ChatSyncPriority;
    },
  ): Promise<ChatSyncOutcome> {
    if (!this.mounted) return Promise.resolve('skipped_unmounted');
    if (!isLoggedInContext(this.context) || !this.context.userId) {
      return Promise.resolve('skipped_no_user');
    }

    const sequence = ++this.sequence;
    const contextKey = this.contextKey;
    const controller = new AbortController();
    const userId = this.context.userId;
    const role = this.context.role;
    const projectId = this.context.projectId;

    const promise = (async (): Promise<ChatSyncOutcome> => {
      try {
        const args = {
          contextKey,
          userId,
          role,
          projectId,
          signal: controller.signal,
          sequence,
          reason: req.reason,
        };
        if (req.scope === 'thread') {
          if (!req.threadId) throw new Error('threadId required');
          await this.transport.syncThread({ ...args, threadId: req.threadId });
        } else {
          await this.transport.syncAll(args);
        }

        if (controller.signal.aborted) {
          return 'cancelled';
        }
        if (!this.mounted) {
          this.metrics.droppedStaleResponses += 1;
          return 'dropped_stale_context';
        }
        if (contextKey !== this.contextKey) {
          this.metrics.droppedStaleResponses += 1;
          return 'dropped_stale_context';
        }
        const scopeKey = `${req.scope}:${req.threadId ?? '_'}`;
        const last = this.latestAppliedByScope.get(scopeKey) ?? 0;
        if (sequence < last) {
          this.metrics.droppedStaleResponses += 1;
          return 'dropped_stale_sequence';
        }
        this.latestAppliedByScope.set(scopeKey, sequence);
        this.metrics.appliedResponses += 1;
        this.pollFailures = 0;
        if (!this.inboxWsConnected) {
          this.pollIntervalMs = this.pollBaseMs;
        }
        this.broadcastInvalidate();
        return 'applied';
      } catch (e) {
        if (controller.signal.aborted) {
          return 'cancelled';
        }
        if (req.reason === 'offline_flush' || req.reason === 'reconnect') {
          this.metrics.reconciliationFailures += 1;
        }
        this.pollFailures += 1;
        if (!this.inboxWsConnected) {
          this.pollIntervalMs = Math.min(
            this.pollMaxMs,
            this.pollBaseMs * 2 ** Math.min(this.pollFailures, 3),
          );
        }
        this.reschedulePoll();
        throw e;
      } finally {
        const cur = this.inflight.get(key);
        if (cur?.sequence === sequence) {
          this.inflight.delete(key);
        }
        if (this.pending.has(key)) {
          void this.flushPending(key);
        } else {
          this.reschedulePoll();
        }
      }
    })();

    this.inflight.set(key, {
      sequence,
      contextKey,
      coalesceKey: key,
      controller,
      priority: req.priority,
      promise: promise.catch(() => 'failed' as const),
    });

    return promise.catch(() => 'failed' as const);
  }

  private cancelAll(_why: string): void {
    for (const t of this.wsTimers.values()) this.clock.clearTimeout(t);
    this.wsTimers.clear();

    for (const entry of this.pending.values()) {
      this.metrics.coalescedRequests += 1;
      entry.resolve('cancelled');
    }
    this.pending.clear();

    for (const entry of this.inflight.values()) {
      entry.controller.abort();
      this.metrics.cancelledRequests += 1;
    }
    this.inflight.clear();
  }

  private stopPoll(): void {
    if (this.pollTimer) {
      this.clock.clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private reschedulePoll(): void {
    this.stopPoll();
    if (!this.mounted || !isLoggedInContext(this.context)) return;

    const delay = this.inboxWsConnected ? POLL_WHEN_WS_MS : this.pollIntervalMs;
    this.pollTimer = this.clock.setTimeout(() => {
      this.pollTimer = null;
      void this.requestSync({ scope: 'all', reason: 'poll', priority: 'low' }).finally(() => {
        this.reschedulePoll();
      });
    }, delay);
  }

  private broadcastInvalidate(): void {
    try {
      this.broadcast?.postMessage({ type: 'invalidate', contextKey: this.contextKey });
    } catch {
      /* noop */
    }
  }
}

function defaultPriority(reason: ChatSyncReason): ChatSyncPriority {
  switch (reason) {
    case 'manual':
    case 'offline_flush':
    case 'reconnect':
    case 'project_change':
      return 'high';
    case 'poll':
      return 'low';
    default:
      return 'normal';
  }
}

function maxPriority(a: ChatSyncPriority, b: ChatSyncPriority): ChatSyncPriority {
  return PRIORITY_RANK[a] >= PRIORITY_RANK[b] ? a : b;
}

function defaultBroadcastFactory(): {
  postMessage: (data: unknown) => void;
  onmessage: ((ev: { data: unknown }) => void) | null;
  close: () => void;
} | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  try {
    const ch = new BroadcastChannel('renova-chat-sync');
    return {
      postMessage: (data) => ch.postMessage(data),
      get onmessage() {
        return ch.onmessage as ((ev: { data: unknown }) => void) | null;
      },
      set onmessage(fn) {
        ch.onmessage = fn as typeof ch.onmessage;
      },
      close: () => ch.close(),
    };
  } catch {
    return null;
  }
}
