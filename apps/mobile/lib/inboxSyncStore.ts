/** Единый store: chat threads, unread, inbox задачи — один reload и одно WS */
import { api, type ChatThread, type ProjectDetail, type UserRole } from '@/lib/api';
import {
  buildInboxItemsWithHealth,
  type InboxBuildIssue,
  type InboxItem,
} from '@/lib/domain/buildInboxItems';
import { selectConfirmedInboxSnapshot } from '@/lib/domain/inboxIntegrity';
import { mergeOfflineInboxItem } from '@/lib/domain/offlineInbox';
import { getOfflineOutboxStatus } from '@/lib/offline';
import { emitInboxWs, subscribeInboxWs } from '@/lib/inboxWsBus';
import type { OsRole } from '@/constants/osSections';
import { buildWsAuthQuery } from '@/lib/wsAuthQuery';
import { createTrailingReloadScheduler } from '@/lib/trailingReloadScheduler';
import { reportError } from '@/lib/reportError';

type Listener = () => void;
type InboxWsPayload = { type?: string; event?: string; thread_id?: string; project_id?: string };
type ReloadOpts = {
  userId?: string;
  userRole?: UserRole;
  projectId?: string;
  project?: ProjectDetail | null;
  osRole?: OsRole;
};
type InboxSyncIssue = InboxBuildIssue | { projectId: string; source: 'build' };

export type InboxHealthSnapshot = {
  status: 'idle' | 'complete' | 'degraded';
  issues: InboxSyncIssue[];
  hasConfirmedSnapshot: boolean;
  lastCompleteAt?: string;
};

const POLL_DISCONNECTED_MS = 25_000;
const POLL_CONNECTED_MS = 60_000;
const WS_RELOAD_DEBOUNCE_MS = 180;
const WS_RELOAD_MAX_WAIT_MS = 900;
const listeners = new Set<Listener>();

let chatCount = 0;
let chatFailed = false;
let inboxWsConnected = false;
let chatThreads: ChatThread[] = [];
let inboxItems: InboxItem[] = [];
let inboxBadge = 0;
let inboxHealthSnapshot: InboxHealthSnapshot = {
  status: 'idle',
  issues: [],
  hasConfirmedSnapshot: false,
};

let activeUserId: string | undefined;
let inboxContextKey = '';
let confirmedInboxKey = '';
let reloadGeneration = 0;

let wsUserId: string | undefined;
let wsRefCount = 0;
let wsCleanup: (() => void) | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let reloadInflight: { key: string; promise: Promise<void> } | null = null;

export function subscribeInboxSync(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify() {
  Array.from(listeners).forEach((fn) => {
    try {
      fn();
    } catch (error) {
      reportError('inbox.listener', error);
    }
  });
}

function sumChatUnread(threads: ChatThread[]): number {
  return threads
    .filter((thread) => !thread.is_archived)
    .reduce((sum, thread) => sum + (thread.unread_count || 0), 0);
}

function applyLocalThreadUnread(threadId: string, unread = 0) {
  chatThreads = chatThreads.map((thread) =>
    thread.id === threadId ? { ...thread, unread_count: unread } : thread,
  );
  chatCount = sumChatUnread(chatThreads);
}

export function getChatUnreadSnapshot() {
  return { count: chatCount, failed: chatFailed, inboxWsConnected };
}

export function getChatUnreadCountSnapshot() {
  return chatCount;
}

export function getChatFailedSnapshot() {
  return chatFailed;
}

export function getInboxWsConnectedSnapshot() {
  return inboxWsConnected;
}

export function getChatInboxThreadsSnapshot(): ChatThread[] {
  return chatThreads;
}

export function getInboxTasksSnapshot() {
  return { items: inboxItems, badge: inboxBadge, health: inboxHealthSnapshot };
}

export function getInboxBadgeSnapshot() {
  return inboxBadge;
}

export function getInboxItemsSnapshot() {
  return inboxItems;
}

export function getInboxHealthSnapshot(): InboxHealthSnapshot {
  return inboxHealthSnapshot;
}

function snapshotState() {
  return {
    chatCount,
    chatFailed,
    chatThreads,
    inboxBadge,
    inboxHealthSnapshot,
    inboxItems,
    inboxWsConnected,
  };
}

function notifyIfChanged(prev: ReturnType<typeof snapshotState>) {
  if (
    prev.chatCount === chatCount
    && prev.chatFailed === chatFailed
    && prev.chatThreads === chatThreads
    && prev.inboxBadge === inboxBadge
    && prev.inboxHealthSnapshot === inboxHealthSnapshot
    && prev.inboxItems === inboxItems
    && prev.inboxWsConnected === inboxWsConnected
  ) {
    return;
  }
  notify();
}

function setInboxHealth(
  status: InboxHealthSnapshot['status'],
  issues: InboxSyncIssue[],
  hasConfirmedSnapshot: boolean,
  lastCompleteAt?: string | null,
) {
  inboxHealthSnapshot = {
    status,
    issues,
    hasConfirmedSnapshot,
    ...(lastCompleteAt ? { lastCompleteAt } : {}),
  };
}

async function loadChatState(userId: string): Promise<{ threads: ChatThread[]; unread: number; ok: boolean }> {
  try {
    const threads = await api.chatInbox(userId);
    return { threads, unread: sumChatUnread(threads), ok: true };
  } catch (error) {
    reportError('inbox.chatInbox', error, { userId });
    try {
      const { count } = await api.chatUnreadTotal(userId);
      return { threads: chatThreads, unread: count, ok: true };
    } catch (fallbackError) {
      reportError('inbox.chatUnreadTotal', fallbackError, { userId });
      return { threads: chatThreads, unread: chatCount, ok: false };
    }
  }
}

let cachedFullSync: {
  userId: string;
  userRole?: UserRole;
  projectId: string;
  osRole: OsRole;
  project?: ProjectDetail | null;
} | null = null;

function mergeReloadOpts(opts: ReloadOpts): ReloadOpts {
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

/** После markChatRead / partial reload — синхронизировать строку чата и inboxBadge с chatCount */
function refreshInboxChatRow(nextChat: number) {
  const unread = Math.max(0, nextChat || 0);
  if (unread <= 0) {
    inboxItems = inboxItems.filter((item) => item.kind !== 'chat');
  } else if (inboxItems.some((item) => item.kind === 'chat')) {
    inboxItems = inboxItems.map((item) =>
      item.kind === 'chat' ? { ...item, sub: `${unread} непрочитанных` } : item,
    );
  } else {
    const role = cachedFullSync?.osRole ?? 'customer';
    inboxItems = [
      {
        id: 'chat',
        kind: 'chat',
        title: 'Непрочитанные сообщения',
        sub: `${unread} непрочитанных`,
        href: role === 'contractor' ? '/(contractor)/(tabs)/chat' : '/(customer)/(tabs)/chat',
        priority: 90,
      },
      ...inboxItems,
    ];
  }
  const taskRows = inboxItems.filter((item) => item.kind !== 'chat').length;
  inboxBadge = taskRows + unread;
}

function resetForSignedOut() {
  chatCount = 0;
  chatFailed = false;
  chatThreads = [];
  inboxItems = [];
  inboxBadge = 0;
  inboxContextKey = '';
  confirmedInboxKey = '';
  activeUserId = undefined;
  cachedFullSync = null;
  setInboxHealth('idle', [], false, null);
}

function prepareReloadContext(merged: ReloadOpts) {
  const prev = snapshotState();
  if (!merged.userId) {
    resetForSignedOut();
    notifyIfChanged(prev);
    return;
  }

  if (activeUserId !== merged.userId) {
    activeUserId = merged.userId;
    chatCount = 0;
    chatFailed = false;
    chatThreads = [];
    inboxItems = [];
    inboxBadge = 0;
    inboxContextKey = '';
    confirmedInboxKey = '';
    setInboxHealth('idle', [], false, null);
  }

  if (merged.projectId && merged.osRole) {
    const nextContextKey = [merged.userId, merged.userRole, merged.projectId, merged.osRole].join(':');
    if (nextContextKey !== inboxContextKey) {
      inboxContextKey = nextContextKey;
      confirmedInboxKey = '';
      inboxItems = [];
      inboxBadge = 0;
      setInboxHealth('idle', [], false, null);
      refreshInboxChatRow(chatCount);
    }
  }

  notifyIfChanged(prev);
}

/** Прочитать тред: optimistic local + API + полный resync */
export async function markChatReadAndSync(
  userId: string,
  projectId: string,
  threadId: string,
  userRole?: UserRole,
  knownUnread = 0,
): Promise<void> {
  const previousThreads = chatThreads;
  const previousChatCount = chatCount;
  const prev = snapshotState();
  void knownUnread;

  applyLocalThreadUnread(threadId, 0);
  refreshInboxChatRow(chatCount);
  notifyIfChanged(prev);

  try {
    await api.markChatRead(userId, projectId, threadId);
    chatFailed = false;
  } catch (error) {
    reportError('inbox.markChatRead', error, { userId, projectId, threadId });
    const failedPrev = snapshotState();
    chatThreads = previousThreads;
    chatCount = previousChatCount;
    chatFailed = true;
    refreshInboxChatRow(chatCount);
    notifyIfChanged(failedPrev);
  }

  await reloadInboxSync(
    {
      userId,
      userRole,
      projectId,
      project: cachedFullSync?.project,
      osRole: cachedFullSync?.osRole,
    },
    true,
  );
  emitInboxWs();
}

export async function reloadInboxSyncAfterChatRead(userId: string, userRole?: UserRole): Promise<void> {
  await reloadInboxSync({ userId, userRole }, true);
  emitInboxWs();
}

export async function reloadInboxSync(opts: ReloadOpts, force = false): Promise<void> {
  if (!opts.userId || (activeUserId && activeUserId !== opts.userId)) {
    cachedFullSync = null;
  }
  const merged = mergeReloadOpts(opts);
  const key = [merged.userId, merged.userRole, merged.projectId, merged.osRole].join(':');
  if (!force && reloadInflight?.key === key) return reloadInflight.promise;

  const generation = ++reloadGeneration;
  prepareReloadContext(merged);

  let request!: Promise<void>;
  request = (async () => {
    if (!merged.userId) return;

    const chatState = await loadChatState(merged.userId);
    if (generation !== reloadGeneration) return;

    chatThreads = chatState.threads;
    chatCount = chatState.unread;
    chatFailed = !chatState.ok;

    const syncProjectId = merged.projectId ?? cachedFullSync?.projectId;
    const syncOsRole = merged.osRole ?? cachedFullSync?.osRole;

    if (syncProjectId && syncOsRole) {
      const previousItems = inboxItems;
      let candidateItems: InboxItem[] = [];
      let issues: InboxSyncIssue[] = chatState.ok
        ? []
        : [{ projectId: syncProjectId, source: 'chat' }];

      try {
        const result = await buildInboxItemsWithHealth({
          userId: merged.userId,
          projectId: syncProjectId,
          role: syncOsRole,
          chatUnread: chatCount,
          project: merged.project ?? cachedFullSync?.project,
        });
        if (generation !== reloadGeneration) return;
        candidateItems = result.items;
        issues = [...issues, ...result.issues];
      } catch (error) {
        reportError('inbox.build.unexpected', error, {
          userId: merged.userId,
          projectId: syncProjectId,
          role: syncOsRole,
        });
        issues.push({ projectId: syncProjectId, source: 'build' });
      }

      try {
        const offline = await getOfflineOutboxStatus();
        if (generation !== reloadGeneration) return;
        candidateItems = mergeOfflineInboxItem(candidateItems, offline);
      } catch (error) {
        reportError('inbox.offlineOutbox', error, { projectId: syncProjectId });
        issues.push({ projectId: syncProjectId, source: 'offline_outbox' });
      }

      if (generation !== reloadGeneration) return;
      const hasConfirmedSnapshot = confirmedInboxKey === inboxContextKey && confirmedInboxKey.length > 0;
      const decision = selectConfirmedInboxSnapshot({
        candidateItems,
        previousItems,
        issueCount: issues.length,
        hasConfirmedSnapshot,
      });
      inboxItems = decision.items;

      if (decision.acceptedCandidate) {
        const taskRows = inboxItems.filter((item) => item.kind !== 'chat').length;
        inboxBadge = taskRows + chatCount;
        confirmedInboxKey = inboxContextKey;
        setInboxHealth('complete', [], true, new Date().toISOString());
      } else {
        refreshInboxChatRow(chatCount);
        setInboxHealth(
          'degraded',
          issues,
          hasConfirmedSnapshot,
          hasConfirmedSnapshot ? inboxHealthSnapshot.lastCompleteAt ?? null : null,
        );
      }
    } else {
      refreshInboxChatRow(chatCount);
    }

    if (generation !== reloadGeneration) return;
    notify();
  })();

  reloadInflight = { key, promise: request };
  try {
    await request;
  } finally {
    if (reloadInflight?.promise === request) reloadInflight = null;
  }
}

function stopPoll() {
  if (!pollTimer) return;
  clearInterval(pollTimer);
  pollTimer = null;
}

function ensurePoll(reload: () => void) {
  stopPoll();
  const intervalMs = inboxWsConnected ? POLL_CONNECTED_MS : POLL_DISCONNECTED_MS;
  pollTimer = setInterval(reload, intervalMs);
}

function stopInboxWebSocket() {
  wsCleanup?.();
  wsCleanup = null;
  wsUserId = undefined;
  wsRefCount = 0;
  inboxWsConnected = false;
  stopPoll();
}

function startInboxWebSocket(userId: string, onReload: () => void | Promise<void>) {
  let alive = true;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let pingTimer: ReturnType<typeof setInterval> | null = null;

  const reloadScheduler = createTrailingReloadScheduler(
    async () => {
      await onReload();
      emitInboxWs();
    },
    {
      debounceMs: WS_RELOAD_DEBOUNCE_MS,
      maxWaitMs: WS_RELOAD_MAX_WAIT_MS,
    },
  );

  const refreshPollCadence = () => {
    if (alive) ensurePoll(reloadScheduler.flush);
  };

  const connect = () => {
    if (!alive || !userId) return;
    const base = (process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:8100').replace(/^http/, 'ws');
    void (async () => {
      try {
        const query = await buildWsAuthQuery();
        if (!alive) return;
        const ws = new WebSocket(`${base}/ws/inbox/${userId}${query}`);

        ws.onopen = () => {
          attempt = 0;
          if (!alive) return;
          const prev = inboxWsConnected;
          inboxWsConnected = true;
          if (!prev) notify();
          refreshPollCadence();
          reloadScheduler.flush();

          if (pingTimer) clearInterval(pingTimer);
          pingTimer = setInterval(() => {
            try {
              if (ws.readyState === WebSocket.OPEN) ws.send('ping');
            } catch {
              /* connection close will drive reconnect */
            }
          }, 25_000);
        };

        ws.onmessage = (event) => {
          if (event.data === 'ping' || event.data === 'pong') return;
          try {
            JSON.parse(event.data) as InboxWsPayload;
          } catch {
            /* server may send a non-JSON invalidation token */
          }
          reloadScheduler.schedule();
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
            if (prev) notify();
            refreshPollCadence();
          }
          if (!alive) return;
          attempt += 1;
          const delay = Math.min(30_000, 2_000 * 2 ** Math.min(attempt - 1, 4));
          reconnectTimer = setTimeout(connect, delay);
        };
      } catch (error) {
        reportError('inbox.websocket.connect', error, { userId });
        if (alive) {
          const prev = inboxWsConnected;
          inboxWsConnected = false;
          if (prev) notify();
          refreshPollCadence();
        }
        attempt += 1;
        reconnectTimer = setTimeout(connect, 4_000);
      }
    })();
  };

  connect();
  refreshPollCadence();

  return () => {
    alive = false;
    reloadScheduler.cancel();
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (pingTimer) clearInterval(pingTimer);
    stopPoll();
  };
}

/** Одно WS на пользователя — ref-counted */
export function ensureInboxWebSocket(
  userId: string | undefined,
  onReload: () => void | Promise<void>,
) {
  if (!userId) {
    stopInboxWebSocket();
    return () => {};
  }

  if (wsUserId && wsUserId !== userId) stopInboxWebSocket();

  if (!wsCleanup || wsUserId !== userId) {
    wsUserId = userId;
    wsCleanup = startInboxWebSocket(userId, onReload);
  }

  wsRefCount += 1;
  return () => {
    wsRefCount = Math.max(0, wsRefCount - 1);
    if (wsRefCount === 0) stopInboxWebSocket();
  };
}

export { subscribeInboxWs, emitInboxWs };
