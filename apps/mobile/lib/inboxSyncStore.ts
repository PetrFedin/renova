/** Единый store: chat threads, unread, inbox задачи — один reload и одно WS */
import { api, type ChatThread, type ProjectDetail, type UserRole } from '@/lib/api';
import { buildInboxItems, type InboxItem } from '@/lib/domain/buildInboxItems';
import { mergeOfflineInboxItem } from '@/lib/domain/offlineInbox';
import { getOfflineOutboxStatus } from '@/lib/offline';
import { emitInboxWs, subscribeInboxWs } from '@/lib/inboxWsBus';
import type { OsRole } from '@/constants/osSections';
import { buildWsAuthQuery } from '@/lib/wsAuthQuery';
import { createTrailingReloadScheduler } from '@/lib/trailingReloadScheduler';

type Listener = () => void;
type InboxWsPayload = { type?: string; event?: string; thread_id?: string; project_id?: string };
type ReloadOpts = {
  userId?: string;
  userRole?: UserRole;
  projectId?: string;
  project?: ProjectDetail | null;
  osRole?: OsRole;
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

let wsUserId: string | undefined;
let wsRefCount = 0;
let wsCleanup: (() => void) | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let reloadInflight: Promise<void> | null = null;
let lastReloadKey = '';

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
    } catch {
      /* noop */
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
  return { items: inboxItems, badge: inboxBadge };
}

export function getInboxBadgeSnapshot() {
  return inboxBadge;
}

export function getInboxItemsSnapshot() {
  return inboxItems;
}

function snapshotState() {
  return {
    chatCount,
    chatFailed,
    inboxBadge,
    inboxItems,
    inboxWsConnected,
  };
}

function notifyIfChanged(prev: ReturnType<typeof snapshotState>) {
  if (
    prev.chatCount === chatCount
    && prev.chatFailed === chatFailed
    && prev.inboxBadge === inboxBadge
    && prev.inboxItems === inboxItems
    && prev.inboxWsConnected === inboxWsConnected
  ) {
    return;
  }
  notify();
}

async function loadChatState(userId: string): Promise<{ threads: ChatThread[]; unread: number; ok: boolean }> {
  try {
    const threads = await api.chatInbox(userId);
    return { threads, unread: sumChatUnread(threads), ok: true };
  } catch {
    try {
      const { count } = await api.chatUnreadTotal(userId);
      return { threads: chatThreads, unread: count, ok: true };
    } catch {
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

/** Прочитать тред: optimistic local + API cursor + resync при ошибке */
export async function markChatReadAndSync(
  userId: string,
  projectId: string,
  threadId: string,
  userRole?: UserRole,
  knownUnread = 0,
  readThroughMessageId?: string | null,
): Promise<void> {
  const prev = snapshotState();
  void knownUnread;

  // Optimistic только для UX; при ошибке API принудительный resync восстановит счётчики
  applyLocalThreadUnread(threadId, 0);
  refreshInboxChatRow(chatCount);
  notifyIfChanged(prev);

  let apiOk = false;
  try {
    await api.markChatRead(userId, projectId, threadId, readThroughMessageId);
    chatFailed = false;
    apiOk = true;
  } catch {
    /* resync ниже */
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

  if (!apiOk) {
    // Не оставляем «вечный 0» без серверного подтверждения — resync уже выполнен
    chatFailed = false;
  }
}

export async function reloadInboxSyncAfterChatRead(userId: string, userRole?: UserRole): Promise<void> {
  await reloadInboxSync({ userId, userRole }, true);
  emitInboxWs();
}

export async function reloadInboxSync(opts: ReloadOpts, force = false): Promise<void> {
  const merged = mergeReloadOpts(opts);
  const key = [merged.userId, merged.userRole, merged.projectId, merged.osRole].join(':');
  if (!force && reloadInflight && lastReloadKey === key) return reloadInflight;

  lastReloadKey = key;
  reloadInflight = (async () => {
    const prev = snapshotState();

    if (!merged.userId) {
      chatCount = 0;
      chatFailed = false;
      chatThreads = [];
      inboxItems = [];
      inboxBadge = 0;
      cachedFullSync = null;
      notifyIfChanged(prev);
      return;
    }

    const chatState = await loadChatState(merged.userId);
    if (chatState.ok) {
      chatThreads = chatState.threads;
      chatCount = chatState.unread;
      chatFailed = false;
    } else {
      chatCount = chatState.unread;
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
          const offline = await getOfflineOutboxStatus();
          inboxItems = mergeOfflineInboxItem(inboxItems, offline);
        } catch {
          /* noop */
        }
        const taskRows = inboxItems.filter((item) => item.kind !== 'chat').length;
        inboxBadge = taskRows + chatCount;
      } catch {
        if (!inboxItems.length) inboxBadge = chatCount;
      }
    } else {
      refreshInboxChatRow(chatCount);
    }

    notifyIfChanged(prev);
  })();

  try {
    await reloadInflight;
  } finally {
    reloadInflight = null;
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
              /* noop */
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
      } catch {
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
