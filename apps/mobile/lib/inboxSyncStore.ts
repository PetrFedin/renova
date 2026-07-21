/**
 * Единый SoT: chat threads + unread + inbox tasks.
 * Один WS, один poll, один inflight sync; stale reload не затирает optimistic mark-read.
 */
import type { ChatThread, MarkChatReadResponse, ProjectDetail, UserRole } from '@/lib/api';
import { buildInboxItems, type InboxItem } from '@/lib/domain/buildInboxItems';
import { mergeOfflineInboxItem } from '@/lib/domain/offlineInbox';
import { getOfflineOutboxStatus } from '@/lib/offline';
import { emitInboxWs, subscribeInboxWs } from '@/lib/inboxWsBus';
import type { OsRole } from '@/constants/osSections';
import { buildWsAuthQuery } from '@/lib/wsAuthQuery';
import {
  bumpMutationInvalidation,
  canApplyReload as canApplyReloadPure,
  sumActiveUnread,
  totalAsIfThreadRead,
} from '@/lib/inboxSyncRevision';

/** Injectable API surface — lazy default, stubs in unit tests. */
type InboxApi = {
  chatInbox: (userId: string) => Promise<ChatThread[]>;
  chatUnreadTotal: (userId: string) => Promise<{ count: number }>;
  markChatRead: (userId: string, projectId: string, threadId: string) => Promise<MarkChatReadResponse>;
};

let apiImpl: InboxApi | null = null;

function getApi(): InboxApi {
  if (apiImpl) return apiImpl;
  // Lazy: не тянем RN-стек при unit-тестах со stubs
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { api: defaultApi } = require('@/lib/api') as { api: InboxApi };
  apiImpl = {
    chatInbox: defaultApi.chatInbox.bind(defaultApi),
    chatUnreadTotal: defaultApi.chatUnreadTotal.bind(defaultApi),
    markChatRead: defaultApi.markChatRead.bind(defaultApi),
  };
  return apiImpl;
}

export type InboxSyncReason =
  | 'initial'
  | 'focus'
  | 'manual'
  | 'websocket_reconcile'
  | 'offline_flush'
  | 'foreground'
  | 'mark_read_failure'
  | 'project_change'
  | 'invariant_reconcile';

export type AppError = { message: string; code?: string };

export type MarkReadResult =
  | { status: 'confirmed'; response: MarkChatReadResponse }
  | { status: 'reconciled' }
  | { status: 'failed'; error: AppError };

type Listener = () => void;
type InboxWsPayload = {
  type?: string;
  event?: string;
  event_id?: string;
  thread_id?: string;
  project_id?: string;
  thread_unread_count?: number;
  total_unread_count?: number;
};

type ReloadMeta = {
  requestSequence: number;
  userId: string;
  startedAtMutationRevision: number;
};

const POLL_MS = 25_000;
const EVENT_LRU_MAX = 64;
const listeners = new Set<Listener>();

let chatCount = 0;
let chatFailed = false;
let inboxWsConnected = false;
let chatThreads: ChatThread[] = [];
let inboxItems: InboxItem[] = [];
let inboxBadge = 0;
/** Неблокирующая ошибка sync прочтения для UI */
let markReadSyncFailed = false;

let wsUserId: string | undefined;
let wsRefCount = 0;
let wsCleanup: (() => void) | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;

/** Последний подтверждённый сервером snapshot revision (из total после mark-read / counters) */
let serverRevision = 0;
/** Локальные мутации (optimistic mark-read) — инвалидируют in-flight reload */
let localMutationRevision = 0;
/** Последовательность reload; старые ответы отбрасываются */
let reloadRequestSequence = 0;

let reloadInflight: Promise<void> | null = null;
let reloadInflightMeta: ReloadMeta | null = null;
let storeUserId: string | null = null;

/**
 * Открытый тред, который пользователь реально видит (focused + foreground).
 * Mounted !== visible: без focus/foreground сообщение увеличивает unread.
 */
let visibleThreadId: string | null = null;
let visibleThreadFocused = false;
let visibleAppForeground = false;

const processedEventIds: string[] = [];
const processedEventSet = new Set<string>();

let cachedFullSync: {
  userId: string;
  userRole?: UserRole;
  projectId: string;
  osRole: OsRole;
  project?: ProjectDetail | null;
} | null = null;

export function subscribeInboxSync(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* noop */
    }
  });
}

export function sumActiveChatUnread(threads: ChatThread[]): number {
  return sumActiveUnread(threads);
}

function sumChatUnread(threads: ChatThread[]): number {
  return sumActiveChatUnread(threads);
}

function rememberEventId(id: string): boolean {
  if (!id) return false;
  if (processedEventSet.has(id)) return true; // duplicate
  processedEventSet.add(id);
  processedEventIds.push(id);
  while (processedEventIds.length > EVENT_LRU_MAX) {
    const old = processedEventIds.shift();
    if (old) processedEventSet.delete(old);
  }
  return false;
}

function applyLocalThreadUnread(threadId: string, unread = 0) {
  chatThreads = chatThreads.map((t) =>
    (t.id === threadId ? { ...t, unread_count: unread } : t),
  );
  chatCount = sumChatUnread(chatThreads);
}

function refreshInboxChatRow(nextChat: number) {
  const n = Math.max(0, nextChat || 0);
  if (n <= 0) {
    inboxItems = inboxItems.filter((i) => i.kind !== 'chat');
  } else if (inboxItems.some((i) => i.kind === 'chat')) {
    inboxItems = inboxItems.map((i) =>
      (i.kind === 'chat' ? { ...i, sub: `${n} непрочитанных` } : i),
    );
  } else {
    const role = cachedFullSync?.osRole ?? 'customer';
    inboxItems = [
      {
        id: 'chat',
        kind: 'chat',
        title: 'Непрочитанные сообщения',
        sub: `${n} непрочитанных`,
        href: role === 'contractor' ? '/(contractor)/(tabs)/chat' : '/(customer)/(tabs)/chat',
        priority: 90,
      },
      ...inboxItems,
    ];
  }
  inboxBadge = inboxItems.filter((i) => i.kind !== 'chat').length;
}

function applyAuthoritativeCounters(
  threadId: string | undefined,
  threadUnread: number | undefined,
  totalUnread: number,
) {
  if (threadId && typeof threadUnread === 'number') {
    const exists = chatThreads.some((t) => t.id === threadId);
    if (exists) {
      chatThreads = chatThreads.map((t) =>
        (t.id === threadId ? { ...t, unread_count: Math.max(0, threadUnread) } : t),
      );
    }
  }
  // Серверный total — authoritative; не откатываем к local sum
  chatCount = Math.max(0, totalUnread);
  serverRevision += 1;
  refreshInboxChatRow(chatCount);

  const localSum = sumChatUnread(chatThreads);
  if (chatThreads.length > 0 && localSum !== chatCount) {
    // Snapshot неполный / рассинхрон — один reconcile без отката total
    void requestInboxSync({ reason: 'invariant_reconcile', force: true });
  }
}

function notifyIfChanged(prev: {
  chatCount: number;
  chatFailed: boolean;
  inboxBadge: number;
  inboxItems: InboxItem[];
  inboxWsConnected: boolean;
  markReadSyncFailed: boolean;
}) {
  if (
    prev.chatCount === chatCount
    && prev.chatFailed === chatFailed
    && prev.inboxBadge === inboxBadge
    && prev.inboxItems === inboxItems
    && prev.inboxWsConnected === inboxWsConnected
    && prev.markReadSyncFailed === markReadSyncFailed
  ) {
    return;
  }
  notify();
}

export function getChatUnreadSnapshot() {
  return { count: chatCount, failed: chatFailed, inboxWsConnected, markReadSyncFailed };
}

export function getChatUnreadCountSnapshot() {
  return chatCount;
}

export function getTotalUnreadSnapshot() {
  return chatCount;
}

export function getChatFailedSnapshot() {
  return chatFailed;
}

export function getMarkReadSyncFailedSnapshot() {
  return markReadSyncFailed;
}

export function getInboxWsConnectedSnapshot() {
  return inboxWsConnected;
}

export function getChatInboxThreadsSnapshot(): ChatThread[] {
  return chatThreads;
}

/** Lookup project_id без side-effect GET chat */
export function findThreadProjectId(threadId: string): string | null {
  return chatThreads.find((t) => t.id === threadId)?.project_id ?? null;
}

/**
 * Сообщить store, какой тред сейчас на экране (focused + AppState).
 * Нужно, чтобы inbox WS не поднимал badge за сообщение, которое пользователь видит.
 */
export function setVisibleChatThread(opts: {
  threadId: string | null;
  focused: boolean;
  foreground: boolean;
}): void {
  visibleThreadId = opts.threadId;
  visibleThreadFocused = Boolean(opts.focused);
  visibleAppForeground = Boolean(opts.foreground);
}

function isThreadVisiblyOpen(threadId: string | undefined): boolean {
  return Boolean(
    threadId
    && visibleThreadId === threadId
    && visibleThreadFocused
    && visibleAppForeground,
  );
}

export function getInboxTasksSnapshot() {
  return { items: inboxItems, badge: inboxBadge };
}

export function getInboxBadgeSnapshot() {
  return inboxBadge;
}

export function getInboxItemsSnapshot() {
  return inboxItems;
}

/** Для тестов: текущие revision counters */
export function getInboxSyncRevisions() {
  return { serverRevision, localMutationRevision, reloadRequestSequence };
}

function mergeReloadOpts(opts: {
  userId?: string;
  userRole?: UserRole;
  projectId?: string;
  project?: ProjectDetail | null;
  osRole?: OsRole;
}) {
  if (opts.userId && opts.projectId && opts.osRole) {
    cachedFullSync = {
      userId: opts.userId,
      userRole: opts.userRole,
      projectId: opts.projectId,
      osRole: opts.osRole,
      project: opts.project,
    };
  }
  if (!opts.userId) return opts;
  if (opts.projectId && opts.osRole) return opts;
  if (!cachedFullSync || cachedFullSync.userId !== opts.userId) return opts;
  return {
    userId: opts.userId,
    userRole: opts.userRole ?? cachedFullSync.userRole,
    projectId: cachedFullSync.projectId,
    osRole: cachedFullSync.osRole,
    project: opts.project ?? cachedFullSync.project,
  };
}

async function loadChatState(userId: string): Promise<{ threads: ChatThread[]; unread: number; ok: boolean }> {
  try {
    const threads = await getApi().chatInbox(userId);
    return { threads, unread: sumChatUnread(threads), ok: true };
  } catch {
    try {
      const { count } = await getApi().chatUnreadTotal(userId);
      return { threads: chatThreads, unread: count, ok: true };
    } catch {
      return { threads: chatThreads, unread: chatCount, ok: false };
    }
  }
}

function canApplyReload(meta: ReloadMeta): boolean {
  return canApplyReloadPure(meta, {
    storeUserId,
    reloadRequestSequence,
    localMutationRevision,
  });
}

/**
 * Инвалидировать все in-flight unread reload (вызывать при начале mark-read).
 * Старые ответы больше не применятся.
 */
export function invalidateUnreadReloads(): void {
  const next = bumpMutationInvalidation({
    serverRevision,
    localMutationRevision,
    reloadRequestSequence,
  });
  localMutationRevision = next.localMutationRevision;
  reloadRequestSequence = next.reloadRequestSequence;
  // Не await старый inflight — stale через sequence/mutation
}

/**
 * Mark-read: optimistic → authoritative POST counters.
 * Не присоединяется к pre-read inflight; не полный reload при успешных counters.
 */
export async function markThreadRead(
  userId: string,
  projectId: string,
  threadId: string,
  _userRole?: UserRole,
  _knownUnread = 0,
): Promise<MarkReadResult> {
  if (storeUserId && storeUserId !== userId) {
    return { status: 'failed', error: { message: 'user_mismatch' } };
  }

  const prev = {
    chatCount,
    chatFailed,
    inboxBadge,
    inboxItems,
    inboxWsConnected,
    markReadSyncFailed,
  };

  // 1) Инвалидация старых reload + optimistic
  invalidateUnreadReloads();
  applyLocalThreadUnread(threadId, 0);
  refreshInboxChatRow(chatCount);
  markReadSyncFailed = false;
  notifyIfChanged(prev);

  try {
    const res = await getApi().markChatRead(userId, projectId, threadId);
    chatFailed = false;
    markReadSyncFailed = false;
    applyAuthoritativeCounters(
      res.thread_id || threadId,
      res.thread_unread_count,
      res.total_unread_count,
    );
    notify();
    return { status: 'confirmed', response: res };
  } catch (e) {
    const err: AppError = {
      message: e instanceof Error ? e.message : 'mark_read_failed',
    };
    // Один force sync; не silent success
    try {
      await requestInboxSync({
        reason: 'mark_read_failure',
        force: true,
        userId,
        userRole: _userRole,
        projectId,
      });
      markReadSyncFailed = false;
      notify();
      return { status: 'reconciled' };
    } catch {
      markReadSyncFailed = true;
      notify();
      return { status: 'failed', error: err };
    }
  }
}

/** @deprecated use markThreadRead */
export async function markChatReadAndSync(
  userId: string,
  projectId: string,
  threadId: string,
  userRole?: UserRole,
  knownUnread = 0,
): Promise<void> {
  await markThreadRead(userId, projectId, threadId, userRole, knownUnread);
}

export async function reloadInboxSyncAfterChatRead(userId: string, userRole?: UserRole): Promise<void> {
  await requestInboxSync({ reason: 'mark_read_failure', force: true, userId, userRole });
}

export async function requestInboxSync(opts: {
  reason: InboxSyncReason;
  force?: boolean;
  userId?: string;
  userRole?: UserRole;
  projectId?: string;
  project?: ProjectDetail | null;
  osRole?: OsRole;
}): Promise<void> {
  const force = Boolean(opts.force);
  const merged = mergeReloadOpts(opts);

  // Не присоединяться к inflight, начатому до локальной мутации
  if (
    !force
    && reloadInflight
    && reloadInflightMeta
    && reloadInflightMeta.userId === (merged.userId || '')
    && reloadInflightMeta.startedAtMutationRevision === localMutationRevision
    && reloadInflightMeta.requestSequence === reloadRequestSequence
  ) {
    return reloadInflight;
  }

  const requestSequence = ++reloadRequestSequence;
  const meta: ReloadMeta = {
    requestSequence,
    userId: merged.userId || '',
    startedAtMutationRevision: localMutationRevision,
  };
  reloadInflightMeta = meta;

  reloadInflight = (async () => {
    const prev = {
      chatCount,
      chatFailed,
      inboxBadge,
      inboxItems,
      inboxWsConnected,
      markReadSyncFailed,
    };

    if (!merged.userId) {
      storeUserId = null;
      chatCount = 0;
      chatFailed = false;
      chatThreads = [];
      inboxItems = [];
      inboxBadge = 0;
      cachedFullSync = null;
      notifyIfChanged(prev);
      return;
    }

    if (storeUserId && storeUserId !== merged.userId) {
      chatCount = 0;
      chatThreads = [];
      inboxItems = [];
      inboxBadge = 0;
      notify();
    }
    storeUserId = merged.userId;

    const chatState = await loadChatState(merged.userId);
    if (!canApplyReload(meta)) return;

    if (chatState.ok) {
      chatThreads = chatState.threads;
      chatCount = sumChatUnread(chatState.threads);
      chatFailed = false;
      serverRevision += 1;
    } else {
      chatCount = Math.max(0, chatState.unread);
      chatFailed = chatThreads.length === 0 && chatCount === 0;
    }

    const syncProjectId = merged.projectId ?? cachedFullSync?.projectId;
    const syncOsRole = merged.osRole ?? cachedFullSync?.osRole;

    if (syncProjectId && syncOsRole) {
      try {
        inboxItems = await buildInboxItems({
          userId: merged.userId,
          projectId: syncProjectId,
          role: syncOsRole,
          chatUnread: chatCount,
          project: merged.project ?? cachedFullSync?.project,
        });
        try {
          const off = await getOfflineOutboxStatus();
          inboxItems = mergeOfflineInboxItem(inboxItems, off);
        } catch { /* noop */ }
        if (!canApplyReload(meta)) return;
        inboxBadge = inboxItems.filter((i) => i.kind !== 'chat').length;
      } catch {
        /* keep previous tasks */
      }
    } else {
      refreshInboxChatRow(chatCount);
    }

    if (!canApplyReload(meta)) return;
    notifyIfChanged(prev);
  })();

  try {
    await reloadInflight;
  } finally {
    if (reloadInflightMeta?.requestSequence === requestSequence) {
      reloadInflight = null;
      reloadInflightMeta = null;
    }
  }
}

/** Совместимость со старым API */
export async function reloadInboxSync(
  opts: {
    userId?: string;
    userRole?: UserRole;
    projectId?: string;
    project?: ProjectDetail | null;
    osRole?: OsRole;
  },
  force = false,
): Promise<void> {
  await requestInboxSync({
    reason: force ? 'manual' : 'focus',
    force,
    ...opts,
  });
}

function ensurePoll(userId: string) {
  if (pollTimer) clearInterval(pollTimer);
  const ms = inboxWsConnected ? 60_000 : POLL_MS;
  pollTimer = setInterval(() => {
    void requestInboxSync({ reason: 'websocket_reconcile', userId, force: false });
  }, ms);
}

function stopPoll() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function stopInboxWebSocket() {
  wsCleanup?.();
  wsCleanup = null;
  wsUserId = undefined;
  wsRefCount = 0;
  inboxWsConnected = false;
  stopPoll();
}

function handleInboxWsPayload(payload: InboxWsPayload) {
  const eventId = payload.event_id;
  if (eventId && rememberEventId(eventId)) {
    return; // duplicate — no reload / no unread bump
  }

  if (
    payload.type === 'chat_read'
    && payload.thread_id
    && typeof payload.thread_unread_count === 'number'
  ) {
    if (typeof payload.total_unread_count === 'number' && payload.total_unread_count >= 0) {
      applyAuthoritativeCounters(
        payload.thread_id,
        payload.thread_unread_count,
        payload.total_unread_count,
      );
    } else {
      applyLocalThreadUnread(payload.thread_id, Math.max(0, payload.thread_unread_count));
      refreshInboxChatRow(chatCount);
    }
    notify();
    return;
  }

  if (
    (payload.type === 'chat_message_created' || payload.event === 'message' || payload.type === 'inbox')
    && typeof payload.total_unread_count === 'number'
    && payload.total_unread_count >= 0
  ) {
    // Открытый focused+foreground тред: пользователь видит сообщение — badge не поднимаем.
    // ChatThreadView после reload вызовет mark-read.
    if (isThreadVisiblyOpen(payload.thread_id)) {
      const asIfRead = totalAsIfThreadRead(
        payload.total_unread_count,
        payload.thread_unread_count ?? 0,
      );
      applyAuthoritativeCounters(payload.thread_id, 0, asIfRead);
      notify();
      return;
    }
    applyAuthoritativeCounters(
      payload.thread_id,
      payload.thread_unread_count,
      payload.total_unread_count,
    );
    notify();
    return;
  }

  // Один deduped reconcile (нет counters)
  void requestInboxSync({
    reason: 'websocket_reconcile',
    userId: storeUserId || wsUserId,
    force: false,
  });
}

function startInboxWebSocket(userId: string) {
  let alive = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let pingTimer: ReturnType<typeof setInterval> | null = null;

  const connect = () => {
    if (!alive || !userId) return;
    const base = (process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:8100').replace(/^http/, 'ws');
    void (async () => {
      try {
        const qs = await buildWsAuthQuery();
        if (!alive) return;
        const ws = new WebSocket(`${base}/ws/inbox/${userId}${qs}`);
        ws.onopen = () => {
          attempt = 0;
          if (alive) {
            const prev = inboxWsConnected;
            inboxWsConnected = true;
            if (!prev) notify();
            ensurePoll(userId);
          }
          pingTimer = setInterval(() => {
            try {
              if (ws.readyState === WebSocket.OPEN) ws.send('ping');
            } catch {
              /* noop */
            }
          }, 25_000);
        };
        ws.onmessage = (e) => {
          if (e.data === 'ping' || e.data === 'pong') return;
          let payload: InboxWsPayload = {};
          try {
            payload = JSON.parse(e.data) as InboxWsPayload;
          } catch {
            /* noop */
          }
          handleInboxWsPayload(payload);
          // Не дублируем emitInboxWs→второй reload: store уже обработал
        };
        ws.onerror = () => {
          ws.close();
        };
        ws.onclose = () => {
          if (pingTimer) clearInterval(pingTimer);
          pingTimer = null;
          if (alive) {
            const prev = inboxWsConnected;
            inboxWsConnected = false;
            if (prev) {
              notify();
              ensurePoll(userId);
            }
          }
          if (!alive) return;
          attempt += 1;
          const delay = Math.min(30_000, 2000 * 2 ** Math.min(attempt - 1, 4));
          timer = setTimeout(connect, delay);
        };
      } catch {
        if (alive) {
          const prev = inboxWsConnected;
          inboxWsConnected = false;
          if (prev) notify();
        }
        attempt += 1;
        timer = setTimeout(connect, 4000);
      }
    })();
  };

  connect();
  ensurePoll(userId);

  return () => {
    alive = false;
    if (timer) clearTimeout(timer);
    if (pingTimer) clearInterval(pingTimer);
    stopPoll();
  };
}

/** Одно WS на пользователя — ref-counted. onReload игнорируется (store сам sync). */
export function ensureInboxWebSocket(userId: string | undefined, _onReload?: () => void) {
  if (!userId) {
    stopInboxWebSocket();
    return () => {};
  }

  if (wsUserId && wsUserId !== userId) {
    stopInboxWebSocket();
  }

  if (!wsCleanup || wsUserId !== userId) {
    wsUserId = userId;
    wsCleanup = startInboxWebSocket(userId);
  }

  wsRefCount += 1;
  return () => {
    wsRefCount = Math.max(0, wsRefCount - 1);
    if (wsRefCount === 0) stopInboxWebSocket();
  };
}

/** Тестовый helper: сброс store */
export function __resetInboxSyncStoreForTests() {
  chatCount = 0;
  chatFailed = false;
  chatThreads = [];
  inboxItems = [];
  inboxBadge = 0;
  markReadSyncFailed = false;
  serverRevision = 0;
  localMutationRevision = 0;
  reloadRequestSequence = 0;
  reloadInflight = null;
  reloadInflightMeta = null;
  storeUserId = null;
  visibleThreadId = null;
  visibleThreadFocused = false;
  visibleAppForeground = false;
  processedEventIds.length = 0;
  processedEventSet.clear();
  cachedFullSync = null;
  apiImpl = null;
}

/** Подмена API — вызывать до requestInboxSync/markThreadRead в unit-тестах. */
export function __setInboxSyncApiForTests(mock: InboxApi) {
  apiImpl = mock;
}

export function __seedInboxSyncStoreForTests(opts: {
  userId: string;
  threads: ChatThread[];
  chatCount?: number;
}) {
  storeUserId = opts.userId;
  chatThreads = opts.threads;
  chatCount = opts.chatCount ?? sumChatUnread(opts.threads);
  refreshInboxChatRow(chatCount);
}

export { subscribeInboxWs, emitInboxWs };

/** Тесты: прогон inbox WS payload через тот же handler, что production */
export function __dispatchInboxWsForTests(payload: InboxWsPayload) {
  handleInboxWsPayload(payload);
}
