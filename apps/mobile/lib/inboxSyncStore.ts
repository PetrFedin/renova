/**
 * Единый источник истины для глобального unread чатов и project-scoped inbox задач.
 *
 * Инварианты:
 * - chatCount относится ко всем неархивным чатам текущего пользователя;
 * - project filter не влияет на chatCount;
 * - старый reload не может перезаписать optimistic/authoritative mark-read;
 * - chat transport один на пользователя, fallback poll работает только без WS;
 * - project-scoped задачи не смешиваются с глобальным chat sync.
 */
import type { ChatThread, MarkChatReadResponse, ProjectDetail, UserRole } from '@/lib/api';
import { buildInboxItems, type InboxItem } from '@/lib/domain/buildInboxItems';
import { mergeOfflineInboxItem } from '@/lib/domain/offlineInbox';
import { getOfflineOutboxStatus } from '@/lib/offline';
import { emitInboxWs, subscribeInboxWs } from '@/lib/inboxWsBus';
import type { OsRole } from '@/constants/osSections';
import { buildWsAuthQuery } from '@/lib/wsAuthQuery';
import { formatUnreadMessagesRu } from '@/lib/formatUnreadMessagesRu';
import { sumActiveUnread } from '@/lib/inboxSyncRevision';

type InboxApi = {
  chatInbox: (userId: string) => Promise<ChatThread[]>;
  chatUnreadTotal: (userId: string) => Promise<{ count: number }>;
  markChatRead: (userId: string, projectId: string, threadId: string) => Promise<MarkChatReadResponse>;
};

let apiImpl: InboxApi | null = null;

function getApi(): InboxApi {
  if (apiImpl) return apiImpl;
  // Lazy import keeps pure store tests independent from the RN API client bootstrap.
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

export type InboxSyncStatus = 'idle' | 'loading' | 'refreshing' | 'success' | 'stale' | 'error';
export type AppError = { message: string; code?: string };

export type InboxSyncResult =
  | { status: 'confirmed'; source: 'threads'; totalUnread: number }
  | { status: 'stale'; source: 'total_fallback'; totalUnread: number; error: AppError }
  | { status: 'failed'; source: 'cache'; totalUnread: number; error: AppError };

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
  unread_revision?: number;
  occurred_at?: string;
};

type GlobalSyncMeta = {
  requestSequence: number;
  userId: string;
  startedAtMutationRevision: number;
};

type ProjectSyncMeta = {
  requestSequence: number;
  contextKey: string;
};

type FullSyncContext = {
  userId: string;
  userRole?: UserRole;
  projectId: string;
  osRole: OsRole;
  project?: ProjectDetail | null;
};

type ChatLoadResult =
  | { source: 'threads'; threads: ChatThread[]; total: number }
  | { source: 'total_fallback'; threads: ChatThread[]; total: number; error: AppError }
  | { source: 'cache'; threads: ChatThread[]; total: number; error: AppError };

const POLL_MS = 25_000;
const EVENT_LRU_MAX = 128;
const listeners = new Set<Listener>();

let chatCount = 0;
let chatFailed = false;
let inboxWsConnected = false;
let chatThreads: ChatThread[] = [];
let inboxItems: InboxItem[] = [];
let inboxBadge = 0;
let markReadSyncFailed = false;
let syncStatus: InboxSyncStatus = 'idle';
let syncError: AppError | null = null;
let lastSyncedAt: number | null = null;

let storeUserId: string | null = null;
let cachedFullSync: FullSyncContext | null = null;

let serverRevision = 0;
let currentUnreadRevision = 0;
let localMutationRevision = 0;
let globalRequestSequence = 0;
let projectRequestSequence = 0;

let globalInflight: Promise<InboxSyncResult> | null = null;
let globalInflightMeta: GlobalSyncMeta | null = null;
let projectInflight: Promise<boolean> | null = null;
let projectInflightMeta: ProjectSyncMeta | null = null;
let reconcileScheduled = false;

let wsUserId: string | undefined;
let wsRefCount = 0;
let wsCleanup: (() => void) | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let pollUserId: string | null = null;

let visibleThreadId: string | null = null;
let visibleThreadFocused = false;
let visibleAppForeground = false;
let visibleThreadOwner: string | null = null;
let visibleRegistrationSequence = 0;
const pendingVisibleThreadIds = new Set<string>();

const processedEventIds: string[] = [];
const processedEventSet = new Set<string>();

export function subscribeInboxSync(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // A broken subscriber must not prevent the remaining UI from updating.
    }
  });
}

function normalizeCount(value: number | null | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value ?? 0));
}

export function sumActiveChatUnread(threads: ChatThread[]): number {
  return normalizeCount(sumActiveUnread(threads));
}

function refreshInboxChatRow(nextChat: number) {
  const count = normalizeCount(nextChat);
  const withoutChat = inboxItems.filter((item) => item.kind !== 'chat');
  if (count <= 0) {
    inboxItems = withoutChat;
  } else {
    const role = cachedFullSync?.osRole ?? 'customer';
    inboxItems = [
      {
        id: 'chat',
        kind: 'chat',
        title: 'Непрочитанные сообщения',
        sub: formatUnreadMessagesRu(count),
        href: role === 'contractor' ? '/(contractor)/(tabs)/chat' : '/(customer)/(tabs)/chat',
        priority: 90,
      },
      ...withoutChat,
    ];
  }
  inboxBadge = inboxItems.filter((item) => item.kind !== 'chat').length;
}

function applyLocalThreadUnread(threadId: string, unread = 0) {
  const nextUnread = normalizeCount(unread);
  chatThreads = chatThreads.map((thread) => (
    thread.id === threadId ? { ...thread, unread_count: nextUnread } : thread
  ));
  chatCount = sumActiveChatUnread(chatThreads);
  refreshInboxChatRow(chatCount);
}

function rememberEventId(id: string): boolean {
  if (!id) return false;
  if (processedEventSet.has(id)) return true;
  processedEventSet.add(id);
  processedEventIds.push(id);
  while (processedEventIds.length > EVENT_LRU_MAX) {
    const old = processedEventIds.shift();
    if (old) processedEventSet.delete(old);
  }
  return false;
}

function acceptUnreadRevision(revision: number | undefined): boolean {
  if (!Number.isFinite(revision)) return true;
  const next = Math.trunc(revision ?? 0);
  if (next <= currentUnreadRevision) return false;
  currentUnreadRevision = next;
  return true;
}

function contextKey(userId: string, projectId?: string, osRole?: OsRole): string {
  return `${userId}:${projectId ?? 'global'}:${osRole ?? 'none'}`;
}

function toAppError(error: unknown, fallback: string): AppError {
  if (error instanceof Error) return { message: error.message || fallback };
  return { message: fallback };
}

function captureComparableState() {
  return {
    chatCount,
    chatFailed,
    inboxItems,
    inboxBadge,
    inboxWsConnected,
    markReadSyncFailed,
    syncStatus,
    syncError,
    lastSyncedAt,
    chatThreads,
  };
}

function notifyIfChanged(previous: ReturnType<typeof captureComparableState>) {
  if (
    previous.chatCount === chatCount
    && previous.chatFailed === chatFailed
    && previous.inboxItems === inboxItems
    && previous.inboxBadge === inboxBadge
    && previous.inboxWsConnected === inboxWsConnected
    && previous.markReadSyncFailed === markReadSyncFailed
    && previous.syncStatus === syncStatus
    && previous.syncError === syncError
    && previous.lastSyncedAt === lastSyncedAt
    && previous.chatThreads === chatThreads
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

export function getInboxItemsSnapshot() {
  return inboxItems;
}

export function getInboxTasksSnapshot() {
  return { items: inboxItems, badge: inboxBadge };
}

export function getInboxBadgeSnapshot() {
  return inboxBadge;
}

export function getInboxSyncStateSnapshot() {
  return {
    userId: storeUserId,
    status: syncStatus,
    error: syncError,
    lastSyncedAt,
    totalUnread: chatCount,
  };
}

export function getInboxSyncRevisions() {
  return {
    serverRevision,
    currentUnreadRevision,
    localMutationRevision,
    reloadRequestSequence: globalRequestSequence,
    projectRequestSequence,
  };
}

export function findThreadProjectId(threadId: string): string | null {
  return chatThreads.find((thread) => thread.id === threadId)?.project_id ?? null;
}

export function registerVisibleChatThread(opts: {
  threadId: string;
  focused: boolean;
  foreground: boolean;
}): string {
  const owner = `visible:${++visibleRegistrationSequence}`;
  visibleThreadOwner = owner;
  visibleThreadId = opts.threadId;
  visibleThreadFocused = Boolean(opts.focused);
  visibleAppForeground = Boolean(opts.foreground);
  return owner;
}

export function updateVisibleChatThread(
  owner: string,
  opts: { threadId: string; focused: boolean; foreground: boolean },
): void {
  if (visibleThreadOwner !== owner) return;
  visibleThreadId = opts.threadId;
  visibleThreadFocused = Boolean(opts.focused);
  visibleAppForeground = Boolean(opts.foreground);
}

export function unregisterVisibleChatThread(owner: string): void {
  if (visibleThreadOwner !== owner) return;
  visibleThreadOwner = null;
  visibleThreadId = null;
  visibleThreadFocused = false;
  visibleAppForeground = false;
}

/** Legacy adapter. New code should use register/update/unregister with an owner token. */
export function setVisibleChatThread(opts: {
  threadId: string | null;
  focused: boolean;
  foreground: boolean;
}): void {
  const owner = 'legacy-visible-thread';
  if (!opts.threadId) {
    if (visibleThreadOwner === owner) unregisterVisibleChatThread(owner);
    return;
  }
  visibleThreadOwner = owner;
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

function resetDataState() {
  chatCount = 0;
  chatFailed = false;
  chatThreads = [];
  inboxItems = [];
  inboxBadge = 0;
  markReadSyncFailed = false;
  syncStatus = 'idle';
  syncError = null;
  lastSyncedAt = null;
  cachedFullSync = null;
  currentUnreadRevision = 0;
  pendingVisibleThreadIds.clear();
  processedEventIds.length = 0;
  processedEventSet.clear();
  visibleThreadOwner = null;
  visibleThreadId = null;
  visibleThreadFocused = false;
  visibleAppForeground = false;
}

export function resetInboxSync(options: { stopTransport?: boolean } = {}): void {
  const previous = captureComparableState();
  localMutationRevision += 1;
  globalRequestSequence += 1;
  projectRequestSequence += 1;
  globalInflight = null;
  globalInflightMeta = null;
  projectInflight = null;
  projectInflightMeta = null;
  storeUserId = null;
  resetDataState();
  if (options.stopTransport !== false) stopInboxWebSocket();
  notifyIfChanged(previous);
}

function setUserScope(userId: string) {
  if (storeUserId === userId) return;
  const previous = captureComparableState();
  localMutationRevision += 1;
  globalRequestSequence += 1;
  projectRequestSequence += 1;
  globalInflight = null;
  globalInflightMeta = null;
  projectInflight = null;
  projectInflightMeta = null;
  storeUserId = userId;
  resetDataState();
  storeUserId = userId;
  notifyIfChanged(previous);
}

function mergeFullSyncContext(opts: {
  userId: string;
  userRole?: UserRole;
  projectId?: string;
  project?: ProjectDetail | null;
  osRole?: OsRole;
}): FullSyncContext | null {
  if (opts.projectId && opts.osRole) {
    cachedFullSync = {
      userId: opts.userId,
      userRole: opts.userRole,
      projectId: opts.projectId,
      osRole: opts.osRole,
      project: opts.project,
    };
    return cachedFullSync;
  }
  if (cachedFullSync?.userId === opts.userId) return cachedFullSync;
  return null;
}

async function loadChatState(userId: string): Promise<ChatLoadResult> {
  try {
    const threads = await getApi().chatInbox(userId);
    return {
      source: 'threads',
      threads,
      total: sumActiveChatUnread(threads),
    };
  } catch (threadsError) {
    try {
      const { count } = await getApi().chatUnreadTotal(userId);
      return {
        source: 'total_fallback',
        threads: chatThreads,
        total: normalizeCount(count),
        error: toAppError(threadsError, 'chat_inbox_failed'),
      };
    } catch (totalError) {
      return {
        source: 'cache',
        threads: chatThreads,
        total: chatCount,
        error: toAppError(totalError, 'chat_sync_failed'),
      };
    }
  }
}

function canApplyGlobal(meta: GlobalSyncMeta): boolean {
  return Boolean(
    storeUserId === meta.userId
    && globalRequestSequence === meta.requestSequence
    && localMutationRevision === meta.startedAtMutationRevision,
  );
}

async function syncGlobalChat(userId: string, force: boolean): Promise<InboxSyncResult> {
  if (
    !force
    && globalInflight
    && globalInflightMeta
    && globalInflightMeta.userId === userId
    && globalInflightMeta.startedAtMutationRevision === localMutationRevision
    && globalInflightMeta.requestSequence === globalRequestSequence
  ) {
    return globalInflight;
  }

  const meta: GlobalSyncMeta = {
    requestSequence: ++globalRequestSequence,
    userId,
    startedAtMutationRevision: localMutationRevision,
  };
  globalInflightMeta = meta;
  const previous = captureComparableState();
  syncStatus = chatThreads.length || chatCount ? 'refreshing' : 'loading';
  syncError = null;
  notifyIfChanged(previous);

  globalInflight = (async () => {
    const loaded = await loadChatState(userId);
    if (!canApplyGlobal(meta)) {
      return { status: 'failed', source: 'cache', totalUnread: chatCount, error: { message: 'stale_sync_ignored' } };
    }

    const beforeApply = captureComparableState();
    if (loaded.source === 'threads') {
      chatThreads = loaded.threads;
      chatCount = loaded.total;
      chatFailed = false;
      syncStatus = 'success';
      syncError = null;
      lastSyncedAt = Date.now();
      serverRevision += 1;
      refreshInboxChatRow(chatCount);
      notifyIfChanged(beforeApply);
      return { status: 'confirmed', source: 'threads', totalUnread: chatCount };
    }

    if (loaded.source === 'total_fallback') {
      // The total endpoint is authoritative for the global badge. The thread list remains stale.
      chatCount = loaded.total;
      chatFailed = false;
      syncStatus = 'stale';
      syncError = loaded.error;
      lastSyncedAt = Date.now();
      serverRevision += 1;
      refreshInboxChatRow(chatCount);
      notifyIfChanged(beforeApply);
      return {
        status: 'stale',
        source: 'total_fallback',
        totalUnread: chatCount,
        error: loaded.error,
      };
    }

    chatFailed = true;
    syncStatus = chatThreads.length || chatCount ? 'stale' : 'error';
    syncError = loaded.error;
    notifyIfChanged(beforeApply);
    return {
      status: 'failed',
      source: 'cache',
      totalUnread: chatCount,
      error: loaded.error,
    };
  })();

  try {
    return await globalInflight;
  } finally {
    if (globalInflightMeta?.requestSequence === meta.requestSequence) {
      globalInflight = null;
      globalInflightMeta = null;
    }
  }
}

async function syncProjectInbox(context: FullSyncContext, force: boolean): Promise<boolean> {
  const key = contextKey(context.userId, context.projectId, context.osRole);
  if (
    !force
    && projectInflight
    && projectInflightMeta?.contextKey === key
    && projectInflightMeta.requestSequence === projectRequestSequence
  ) {
    return projectInflight;
  }

  const meta: ProjectSyncMeta = {
    requestSequence: ++projectRequestSequence,
    contextKey: key,
  };
  projectInflightMeta = meta;

  projectInflight = (async () => {
    try {
      let nextItems = await buildInboxItems({
        userId: context.userId,
        projectId: context.projectId,
        role: context.osRole,
        chatUnread: chatCount,
        project: context.project,
      });
      try {
        nextItems = mergeOfflineInboxItem(nextItems, await getOfflineOutboxStatus());
      } catch {
        // Offline status is supplemental; keep the server items.
      }

      if (
        storeUserId !== context.userId
        || projectRequestSequence !== meta.requestSequence
        || projectInflightMeta?.contextKey !== key
      ) {
        return false;
      }

      const previous = captureComparableState();
      inboxItems = nextItems;
      inboxBadge = inboxItems.filter((item) => item.kind !== 'chat').length;
      notifyIfChanged(previous);
      return true;
    } catch {
      return false;
    }
  })();

  try {
    return await projectInflight;
  } finally {
    if (projectInflightMeta?.requestSequence === meta.requestSequence) {
      projectInflight = null;
      projectInflightMeta = null;
    }
  }
}

export async function requestInboxSync(opts: {
  reason: InboxSyncReason;
  force?: boolean;
  userId?: string;
  userRole?: UserRole;
  projectId?: string;
  project?: ProjectDetail | null;
  osRole?: OsRole;
  scope?: 'all' | 'chat';
}): Promise<InboxSyncResult> {
  if (!opts.userId) {
    resetInboxSync();
    return {
      status: 'failed',
      source: 'cache',
      totalUnread: 0,
      error: { message: 'missing_user' },
    };
  }

  setUserScope(opts.userId);
  const context = mergeFullSyncContext({
    userId: opts.userId,
    userRole: opts.userRole,
    projectId: opts.projectId,
    project: opts.project,
    osRole: opts.osRole,
  });

  const result = await syncGlobalChat(opts.userId, Boolean(opts.force));
  if (opts.scope !== 'chat' && context) {
    await syncProjectInbox(context, Boolean(opts.force));
  }
  return result;
}

export function invalidateUnreadReloads(): void {
  localMutationRevision += 1;
  globalRequestSequence += 1;
}

function scheduleInvariantReconcile() {
  if (reconcileScheduled || !storeUserId) return;
  reconcileScheduled = true;
  const userId = storeUserId;
  const context = cachedFullSync?.userId === userId ? cachedFullSync : null;
  queueMicrotask(() => {
    reconcileScheduled = false;
    if (storeUserId !== userId) return;
    void requestInboxSync({
      reason: 'invariant_reconcile',
      force: true,
      userId,
      userRole: context?.userRole,
      projectId: context?.projectId,
      project: context?.project,
      osRole: context?.osRole,
      scope: 'chat',
    });
  });
}

function applyAuthoritativeCounters(
  threadId: string | undefined,
  threadUnread: number | undefined,
  totalUnread: number,
  unreadRevision?: number,
) {
  if (!acceptUnreadRevision(unreadRevision)) return;

  if (threadId && typeof threadUnread === 'number') {
    chatThreads = chatThreads.map((thread) => (
      thread.id === threadId
        ? { ...thread, unread_count: normalizeCount(threadUnread) }
        : thread
    ));
  }

  chatCount = normalizeCount(totalUnread);
  chatFailed = false;
  syncStatus = 'success';
  syncError = null;
  lastSyncedAt = Date.now();
  serverRevision += 1;
  refreshInboxChatRow(chatCount);

  const localSum = sumActiveChatUnread(chatThreads);
  if (chatThreads.length > 0 && localSum !== chatCount) scheduleInvariantReconcile();
}

export async function markThreadRead(
  userId: string,
  projectId: string,
  threadId: string,
  userRole?: UserRole,
  _knownUnread = 0,
): Promise<MarkReadResult> {
  if (storeUserId && storeUserId !== userId) {
    return { status: 'failed', error: { message: 'user_mismatch' } };
  }
  if (!storeUserId) storeUserId = userId;

  const previous = captureComparableState();
  invalidateUnreadReloads();
  applyLocalThreadUnread(threadId, 0);
  markReadSyncFailed = false;
  notifyIfChanged(previous);

  try {
    const response = await getApi().markChatRead(userId, projectId, threadId);
    const revision = (response as MarkChatReadResponse & { unread_revision?: number }).unread_revision;
    applyAuthoritativeCounters(
      response.thread_id || threadId,
      response.thread_unread_count,
      response.total_unread_count,
      revision,
    );
    pendingVisibleThreadIds.delete(threadId);
    markReadSyncFailed = false;
    notify();
    return { status: 'confirmed', response };
  } catch (error) {
    const appError = toAppError(error, 'mark_read_failed');
    const reconciled = await requestInboxSync({
      reason: 'mark_read_failure',
      force: true,
      userId,
      userRole,
      projectId,
      scope: 'chat',
    });

    if (reconciled.status === 'confirmed' && reconciled.source === 'threads') {
      markReadSyncFailed = false;
      notify();
      return { status: 'reconciled' };
    }

    markReadSyncFailed = true;
    syncStatus = chatThreads.length || chatCount ? 'stale' : 'error';
    syncError = appError;
    notify();
    return { status: 'failed', error: appError };
  }
}

/** @deprecated Use markThreadRead and inspect MarkReadResult. */
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
  await requestInboxSync({
    reason: 'mark_read_failure',
    force: true,
    userId,
    userRole,
    scope: 'chat',
  });
}

/** Compatibility adapter for older callers. */
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

function handleInboxWsPayload(payload: InboxWsPayload) {
  if (payload.event_id && rememberEventId(payload.event_id)) return;

  if (payload.type === 'chat_read' && payload.thread_id) {
    if (
      typeof payload.thread_unread_count === 'number'
      && typeof payload.total_unread_count === 'number'
    ) {
      applyAuthoritativeCounters(
        payload.thread_id,
        payload.thread_unread_count,
        payload.total_unread_count,
        payload.unread_revision,
      );
      notify();
      return;
    }
  }

  const isMessageEvent = payload.type === 'chat_message_created'
    || payload.event === 'message'
    || payload.type === 'inbox';

  if (isMessageEvent && payload.thread_id) {
    // Do not pretend that a message is read before the thread reload/render commit.
    // ChatThreadView will POST /read after the message is actually displayed.
    if (isThreadVisiblyOpen(payload.thread_id)) {
      pendingVisibleThreadIds.add(payload.thread_id);
      return;
    }

    if (
      typeof payload.thread_unread_count === 'number'
      && typeof payload.total_unread_count === 'number'
    ) {
      applyAuthoritativeCounters(
        payload.thread_id,
        payload.thread_unread_count,
        payload.total_unread_count,
        payload.unread_revision,
      );
      notify();
      return;
    }
  }

  if (!storeUserId) return;
  void requestInboxSync({
    reason: 'websocket_reconcile',
    userId: storeUserId,
    userRole: cachedFullSync?.userRole,
    projectId: cachedFullSync?.projectId,
    project: cachedFullSync?.project,
    osRole: cachedFullSync?.osRole,
    scope: 'chat',
  });
}

function stopPoll() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  pollUserId = null;
}

function ensurePoll(userId: string) {
  if (inboxWsConnected) {
    stopPoll();
    return;
  }
  if (pollTimer && pollUserId === userId) return;
  stopPoll();
  pollUserId = userId;
  pollTimer = setInterval(() => {
    if (inboxWsConnected || storeUserId !== userId) return;
    void requestInboxSync({
      reason: 'websocket_reconcile',
      userId,
      userRole: cachedFullSync?.userRole,
      projectId: cachedFullSync?.projectId,
      project: cachedFullSync?.project,
      osRole: cachedFullSync?.osRole,
      scope: 'chat',
    });
  }, POLL_MS);
}

function stopInboxWebSocket() {
  wsCleanup?.();
  wsCleanup = null;
  wsUserId = undefined;
  wsRefCount = 0;
  inboxWsConnected = false;
  stopPoll();
}

function startInboxWebSocket(userId: string) {
  let alive = true;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let attempt = 0;

  const connect = () => {
    if (!alive || !userId) return;
    const base = (process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:8100').replace(/^http/, 'ws');
    void (async () => {
      try {
        const query = await buildWsAuthQuery();
        if (!alive) return;
        const socket = new WebSocket(`${base}/ws/inbox/${userId}${query}`);

        socket.onopen = () => {
          attempt = 0;
          const previous = inboxWsConnected;
          inboxWsConnected = true;
          stopPoll();
          if (!previous) notify();
          pingTimer = setInterval(() => {
            try {
              if (socket.readyState === WebSocket.OPEN) socket.send('ping');
            } catch {
              // Reconnect will be handled by onclose.
            }
          }, 25_000);
        };

        socket.onmessage = (event) => {
          if (event.data === 'ping' || event.data === 'pong') return;
          try {
            handleInboxWsPayload(JSON.parse(event.data) as InboxWsPayload);
          } catch {
            // Malformed payloads are ignored and the fallback poll remains available.
          }
        };

        socket.onerror = () => socket.close();
        socket.onclose = () => {
          if (pingTimer) clearInterval(pingTimer);
          pingTimer = null;
          const previous = inboxWsConnected;
          inboxWsConnected = false;
          if (previous) notify();
          if (!alive) return;
          ensurePoll(userId);
          attempt += 1;
          const delay = Math.min(30_000, 2_000 * 2 ** Math.min(attempt - 1, 4));
          reconnectTimer = setTimeout(connect, delay);
        };
      } catch {
        inboxWsConnected = false;
        ensurePoll(userId);
        attempt += 1;
        reconnectTimer = setTimeout(connect, 4_000);
      }
    })();
  };

  ensurePoll(userId);
  connect();

  return () => {
    alive = false;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (pingTimer) clearInterval(pingTimer);
    stopPoll();
  };
}

export function ensureInboxWebSocket(userId: string | undefined, _onReload?: () => void) {
  if (!userId) {
    stopInboxWebSocket();
    return () => {};
  }

  if (wsUserId && wsUserId !== userId) stopInboxWebSocket();
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

export function __resetInboxSyncStoreForTests() {
  resetInboxSync();
  serverRevision = 0;
  currentUnreadRevision = 0;
  localMutationRevision = 0;
  globalRequestSequence = 0;
  projectRequestSequence = 0;
  apiImpl = null;
}

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
  chatCount = opts.chatCount ?? sumActiveChatUnread(opts.threads);
  syncStatus = 'success';
  lastSyncedAt = Date.now();
  refreshInboxChatRow(chatCount);
}

export function __dispatchInboxWsForTests(payload: InboxWsPayload) {
  handleInboxWsPayload(payload);
}

export function __getPendingVisibleThreadsForTests(): string[] {
  return Array.from(pendingVisibleThreadIds);
}

export { subscribeInboxWs, emitInboxWs };
