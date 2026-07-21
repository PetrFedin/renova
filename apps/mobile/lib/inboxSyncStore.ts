/** Единый store: chat threads, unread, inbox задачи — один reload и одно WS */
import { api, type ChatThread, type ProjectDetail, type UserRole } from '@/lib/api';
import { buildInboxItems, type InboxItem } from '@/lib/domain/buildInboxItems';
import { mergeOfflineInboxItem } from '@/lib/domain/offlineInbox';
import { getOfflineOutboxStatus } from '@/lib/offline';
import { emitInboxWs, subscribeInboxWs } from '@/lib/inboxWsBus';
import type { OsRole } from '@/constants/osSections';
import { buildWsAuthQuery } from '@/lib/wsAuthQuery';

type Listener = () => void;
type InboxWsPayload = { type?: string; event?: string; thread_id?: string; project_id?: string };

const POLL_MS = 25_000;
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
/** Инкремент при смене user / каждом reload — отсекает stale responses */
let syncGeneration = 0;
let storeUserId: string | null = null;

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

function sumChatUnread(threads: ChatThread[]): number {
  return threads
    .filter((t) => !t.is_archived)
    .reduce((sum, t) => sum + (t.unread_count || 0), 0);
}

function applyLocalThreadUnread(threadId: string, unread = 0) {
  chatThreads = chatThreads.map((t) =>
    t.id === threadId ? { ...t, unread_count: unread } : t,
  );
  chatCount = sumChatUnread(chatThreads);
}

export function getChatUnreadSnapshot() {
  return { count: chatCount, failed: chatFailed, inboxWsConnected };
}

export function getChatUnreadCountSnapshot() {
  return chatCount;
}

/** Alias: totalUnread = sum(non-archived thread.unread_count) */
export function getTotalUnreadSnapshot() {
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

/** После markChatRead / partial reload — синхронизировать строку чата и inboxBadge с chatCount */
function refreshInboxChatRow(nextChat: number) {
  const n = Math.max(0, nextChat || 0);
  if (n <= 0) {
    inboxItems = inboxItems.filter((i) => i.kind !== 'chat');
  } else if (inboxItems.some((i) => i.kind === 'chat')) {
    inboxItems = inboxItems.map((i) =>
      i.kind === 'chat' ? { ...i, sub: `${n} непрочитанных` } : i,
    );
  } else {
    // Upsert: иначе dock уже показывает N, а «Входящие» без строки чата / со старым sub.
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
  // Задачи без чата; chatCount = n уже в store
  inboxBadge = inboxItems.filter((i) => i.kind !== 'chat').length;
}

/**
 * Прочитать тред: optimistic unread=0 → пересчёт sum → API mark-read →
 * при ошибке force resync (без отрицательных значений).
 * knownUnread не вычитается вручную — только applyLocalThreadUnread(0) + sum.
 */
export async function markChatReadAndSync(
  userId: string,
  projectId: string,
  threadId: string,
  userRole?: UserRole,
  _knownUnread = 0,
): Promise<void> {
  if (storeUserId && storeUserId !== userId) return;

  const prev = {
    chatCount,
    chatFailed,
    inboxBadge,
    inboxItems,
    inboxWsConnected,
  };

  applyLocalThreadUnread(threadId, 0);
  refreshInboxChatRow(chatCount);
  notifyIfChanged(prev);

  try {
    const res = await api.markChatRead(userId, projectId, threadId) as {
      ok?: boolean;
      thread_id?: string;
      thread_unread_count?: number;
      total_unread_count?: number;
    } | void;
    chatFailed = false;
    if (res && typeof res === 'object') {
      if (typeof res.thread_unread_count === 'number') {
        applyLocalThreadUnread(threadId, Math.max(0, res.thread_unread_count));
      }
      if (typeof res.total_unread_count === 'number' && res.total_unread_count >= 0) {
        // Доверяем серверу только если согласовано с локальной суммой или threads пусты
        const localSum = sumChatUnread(chatThreads);
        if (Math.abs(localSum - res.total_unread_count) <= 0 || chatThreads.length === 0) {
          chatCount = res.total_unread_count;
        } else {
          chatCount = localSum;
        }
        refreshInboxChatRow(chatCount);
        notify();
      }
    }
    // Лёгкий deduped reload без шторма (не force если уже inflight)
    await reloadInboxSync(
      {
        userId,
        userRole,
        projectId,
        project: cachedFullSync?.project,
        osRole: cachedFullSync?.osRole,
      },
      false,
    );
  } catch {
    // Ошибка mark-read → принудительный resync к серверу
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
  }
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
  const gen = ++syncGeneration;
  reloadInflight = (async () => {
    const prev = {
      chatCount,
      chatFailed,
      inboxBadge,
      inboxItems,
      inboxWsConnected,
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
      // Смена пользователя — мгновенно очистить старые counts
      chatCount = 0;
      chatThreads = [];
      inboxItems = [];
      inboxBadge = 0;
      notify();
    }
    storeUserId = merged.userId;

    const chatState = await loadChatState(merged.userId);
    if (gen !== syncGeneration) return; // stale
    if (chatState.ok) {
      chatThreads = chatState.threads;
      chatCount = sumChatUnread(chatState.threads);
      chatFailed = false;
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
        // W78: локальная offline-очередь в том же inbox, что оплаты/приёмка
        try {
          const off = await getOfflineOutboxStatus();
          inboxItems = mergeOfflineInboxItem(inboxItems, off);
        } catch { /* noop */ }
        // inboxBadge = только задачи; chatCount отдельно (не смешивать)
        inboxBadge = inboxItems.filter((i) => i.kind !== 'chat').length;
      } catch {
        /* сохраняем предыдущие задачи */
      }
    } else {
      // Нет projectId в этом вызове — не затираем задачи: только выравниваем чат с chatCount.
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
          let payload: InboxWsPayload & {
            thread_unread_count?: number;
            total_unread_count?: number;
            event_id?: string;
          } = {};
          try {
            payload = JSON.parse(e.data);
          } catch {
            /* noop */
          }
          // Идемпотентные счётчики из payload — без лишнего reload когда возможно
          if (
            payload.type === 'chat_read'
            && payload.thread_id
            && typeof payload.thread_unread_count === 'number'
          ) {
            applyLocalThreadUnread(payload.thread_id, Math.max(0, payload.thread_unread_count));
            if (typeof payload.total_unread_count === 'number' && payload.total_unread_count >= 0) {
              chatCount = Math.max(0, payload.total_unread_count);
            } else {
              chatCount = sumChatUnread(chatThreads);
            }
            refreshInboxChatRow(chatCount);
            notify();
            emitInboxWs();
            return;
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
    })();
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

/** Одно WS на пользователя — ref-counted */
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
