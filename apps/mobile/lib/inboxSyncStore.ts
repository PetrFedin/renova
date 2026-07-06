/** Единый store: chat attention + inbox задачи — один reload и одно WS-подключение */
import { api, type ProjectDetail, type UserRole } from '@/lib/api';
import { buildInboxItems, type InboxItem } from '@/lib/domain/buildInboxItems';
import { emitInboxWs, subscribeInboxWs } from '@/lib/inboxWsBus';
import type { OsRole } from '@/constants/osSections';

type Listener = () => void;
type InboxWsPayload = { type?: string; event?: string; thread_id?: string; project_id?: string };

const POLL_MS = 25_000;
const listeners = new Set<Listener>();

let chatCount = 0;
let chatFailed = false;
let inboxWsConnected = false;
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
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* noop */
    }
  });
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

export function getInboxTasksSnapshot() {
  return { items: inboxItems, badge: inboxBadge };
}

export function getInboxBadgeSnapshot() {
  return inboxBadge;
}

export function getInboxItemsSnapshot() {
  return inboxItems;
}

function notifyIfChanged(prev: {
  chatCount: number;
  chatFailed: boolean;
  inboxBadge: number;
  inboxItems: InboxItem[];
  inboxWsConnected: boolean;
}) {
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


/** Сумма непрочитанных — для badge «непрочитанных» */
async function loadChatUnreadTotal(userId: string): Promise<number> {
  const inbox = await api.chatInbox(userId);
  return inbox
    .filter((t) => !t.is_archived)
    .reduce((sum, t) => sum + (t.unread_count || 0), 0);
}

let cachedFullSync: {
  userId: string;
  userRole?: UserRole;
  projectId: string;
  osRole: OsRole;
  project?: ProjectDetail | null;
} | null = null;

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
    project: cachedFullSync.project,
  };
}

/** После markChatRead — обновить chat badge и строку «Входящие» */
function refreshInboxChatRow(nextChat: number) {
  if (!inboxItems.length) return;
  if (nextChat <= 0) {
    inboxItems = inboxItems.filter((i) => i.kind !== 'chat');
  } else {
    inboxItems = inboxItems.map((i) =>
      i.kind === 'chat' ? { ...i, sub: `${nextChat} в чатах` } : i,
    );
  }
  inboxBadge = inboxItems.length;
}

/** Прочитать тред: optimistic badge + API + полный resync */
export async function markChatReadAndSync(
  userId: string,
  projectId: string,
  threadId: string,
  userRole?: UserRole,
  knownUnread = 0,
): Promise<void> {
  const prev = {
    chatCount,
    chatFailed,
    inboxBadge,
    inboxItems,
    inboxWsConnected,
  };

  if (knownUnread > 0) {
    chatCount = Math.max(0, chatCount - knownUnread);
    refreshInboxChatRow(chatCount);
    notifyIfChanged(prev);
  }

  try {
    await api.markChatRead(userId, projectId, threadId);
  } catch {
    /* resync ниже подтянет актуальное состояние */
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
  const merged = mergeReloadOpts(opts);
  const key = [merged.userId, merged.userRole, merged.projectId, merged.osRole].join(':');
  if (!force && reloadInflight && lastReloadKey === key) return reloadInflight;

  lastReloadKey = key;
  reloadInflight = (async () => {
    const prev = {
      chatCount,
      chatFailed,
      inboxBadge,
      inboxItems,
      inboxWsConnected,
    };

    if (!merged.userId) {
      chatCount = 0;
      chatFailed = false;
      inboxItems = [];
      inboxBadge = 0;
      cachedFullSync = null;
      notifyIfChanged(prev);
      return;
    }

    let nextChat = 0;
    let chatOk = false;
    try {
      nextChat = await loadChatUnreadTotal(merged.userId);
      chatOk = true;
    } catch {
      chatOk = false;
    }
    chatCount = nextChat;
    chatFailed = !chatOk && nextChat === 0;

    if (merged.projectId && merged.osRole) {
      try {
        inboxItems = await buildInboxItems({
          userId: merged.userId,
          projectId: merged.projectId,
          role: merged.osRole,
          chatUnread: nextChat,
          project: merged.project,
        });
        inboxBadge = inboxItems.length;
      } catch {
        inboxItems = [];
        inboxBadge = 0;
      }
    }

    notifyIfChanged(prev);
  })();

  try {
    await reloadInflight;
  } finally {
    reloadInflight = null;
  }
}

function ensurePoll(userId: string, reload: () => void) {
  if (pollTimer) clearInterval(pollTimer);
  const ms = inboxWsConnected ? 60_000 : POLL_MS;
  pollTimer = setInterval(() => {
    reload();
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

function startInboxWebSocket(userId: string, onReload: () => void) {
  let alive = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let pingTimer: ReturnType<typeof setInterval> | null = null;

  const connect = () => {
    if (!alive || !userId) return;
    const base = (process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:8100').replace(/^http/, 'ws');
    try {
      const ws = new WebSocket(`${base}/ws/inbox/${userId}`);
      ws.onopen = () => {
        attempt = 0;
        if (alive) {
          const prev = inboxWsConnected;
          inboxWsConnected = true;
          if (!prev) notify();
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
        try {
          JSON.parse(e.data) as InboxWsPayload;
        } catch {
          /* noop */
        }
        onReload();
        emitInboxWs();
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
  };

  connect();
  ensurePoll(userId, onReload);

  return () => {
    alive = false;
    if (timer) clearTimeout(timer);
    if (pingTimer) clearInterval(pingTimer);
    stopPoll();
  };
}

/** Одно WS на пользователя — ref-counted, все экраны слушают через inboxWsBus */
export function ensureInboxWebSocket(userId: string | undefined, onReload: () => void) {
  if (!userId) {
    stopInboxWebSocket();
    return () => {};
  }

  if (wsUserId && wsUserId !== userId) {
    stopInboxWebSocket();
  }

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
