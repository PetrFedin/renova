/** Единый store: chat threads, unread, inbox задачи — один reload и одно WS */
import { api, type ChatThread, type ProjectDetail, type UserRole } from '@/lib/api';
import { buildInboxItems, type InboxItem } from '@/lib/domain/buildInboxItems';
import { mergeOfflineInboxItem } from '@/lib/domain/offlineInbox';
import { getOfflineOutboxStatus } from '@/lib/offline';
import { emitInboxWs, subscribeInboxWs } from '@/lib/inboxWsBus';
import type { OsRole } from '@/constants/osSections';
import { buildWsAuthQuery } from '@/lib/wsAuthQuery';
import {
  decideMarkReadAction,
  recordMarkReadDiag,
  type ConfirmedReadCursor,
  type MarkThreadReadSource,
} from '@/lib/domain/markThreadReadPolicy';
import {
  applyChatUnreadSnapshot,
  parseChatUnreadSnapshotApi,
  patchThreadUnreadInSnapshot,
  setThreadArchivedInSnapshot,
  snapshotFromThreads,
  sumActiveThreadUnread,
  warnUnreadInvariantIfBroken,
  type ChatUnreadSnapshot,
} from '@/lib/domain/chatUnreadSnapshot';
import {
  EMPTY_ACTIVE_THREAD_CONTEXT,
  isActivelyReadingThread,
  type ActiveThreadContext,
} from '@/lib/domain/activeThreadContext';
import {
  clearIncomingMessageDedupe,
  clampSnapshotForActiveRead,
  decideIncomingChatMessage,
  type IncomingChatMessageEvent,
} from '@/lib/domain/incomingChatMessage';
import {
  selectUnreadCount,
  type UnreadCountResult,
  type UnreadScope,
} from '@/lib/domain/unreadScope';
import { formatUnreadCount } from '@/lib/i18n';

type Listener = () => void;
type InboxWsPayload = { type?: string; event?: string; thread_id?: string; project_id?: string };

const listeners = new Set<Listener>();

/** SoT unread: атомарный snapshot (threads + total + revision) */
let unreadSnapshot: ChatUnreadSnapshot | null = null;
/** Открытый видимый тред — для suppress unread flicker */
let activeThreadContext: ActiveThreadContext = { ...EMPTY_ACTIVE_THREAD_CONTEXT };
let chatCount = 0;
let chatFailed = false;
/** Список не загрузился / устарел — total не подменяем отдельно */
let chatUnreadStale = false;
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
let loadGeneration = 0;
/** Последний userId, для которого загружали unread — смена → сброс snapshot */
let lastChatUserId: string | undefined;

/** In-flight mark-read: один запрос на threadId */
const markInflight = new Map<string, Promise<MarkThreadReadResult>>();
/** Последний подтверждённый сервером cursor */
const confirmedRead = new Map<string, ConfirmedReadCursor>();

export type MarkThreadReadArgs = {
  userId: string;
  projectId: string;
  threadId: string;
  throughMessageId?: string | null;
  throughCreatedAt?: string | null;
  userRole?: UserRole;
  source: MarkThreadReadSource;
  /** Повтор после ошибки сети — обойти skip_same */
  force?: boolean;
};

export type MarkThreadReadResult = {
  status: 'sent' | 'deduplicated' | 'skipped_same' | 'skipped_stale' | 'error';
  threadId: string;
  throughMessageId: string | null;
  source: MarkThreadReadSource;
};

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

/** Атомарно зафиксировать snapshot в store-полях */
function commitUnreadSnapshot(next: ChatUnreadSnapshot, opts?: { failed?: boolean; stale?: boolean }) {
  unreadSnapshot = next;
  chatThreads = next.threads;
  chatCount = next.totalUnreadMessages;
  if (opts?.failed != null) chatFailed = opts.failed;
  if (opts?.stale != null) chatUnreadStale = opts.stale;
  warnUnreadInvariantIfBroken(next, undefined, 'commitUnreadSnapshot');
}

function applyIncomingSnapshot(
  incoming: ChatUnreadSnapshot,
  opts?: { force?: boolean },
): boolean {
  const result = applyChatUnreadSnapshot(unreadSnapshot, incoming, opts);
  if (!result.ok) {
    chatUnreadStale = true;
    warnUnreadInvariantIfBroken(result.snapshot, undefined, 'stale_revision_rejected');
    return false;
  }
  const tid = activeThreadContext.threadId;
  const reading = tid ? isActivelyReadingThread(activeThreadContext, tid) : false;
  const serverUnread = reading && tid
    ? (result.snapshot.threads.find((t) => t.id === tid)?.unread_count ?? 0)
    : 0;

  // Одна транзакция: snapshot + clamp unread активного читаемого треда (нет 0→N→0)
  const clamped = clampSnapshotForActiveRead(
    result.snapshot,
    activeThreadContext,
    sumActiveThreadUnread,
  );
  commitUnreadSnapshot(
    snapshotFromThreads(clamped.threads, result.snapshot.revision, result.snapshot.updatedAt),
    { failed: false, stale: false },
  );

  // Сервер ещё считает unread — подтвердить cursor без визуального bump
  if (reading && tid && serverUnread > 0) {
    const ctx = { ...activeThreadContext };
    queueMicrotask(() => {
      if (!ctx.userId || !ctx.projectId || !ctx.threadId) return;
      if (!isActivelyReadingThread(activeThreadContext, ctx.threadId)) return;
      void markThreadRead({
        userId: ctx.userId,
        projectId: ctx.projectId,
        threadId: ctx.threadId,
        source: 'thread_ws',
      });
    });
  }
  return true;
}

function applyLocalThreadUnread(threadId: string, unread = 0) {
  const base = unreadSnapshot ?? snapshotFromThreads(chatThreads, Date.now());
  // Не поднимаем unread активного читаемого треда локальным patch
  const nextUnread = isActivelyReadingThread(activeThreadContext, threadId)
    ? 0
    : unread;
  const next = patchThreadUnreadInSnapshot(base, threadId, nextUnread);
  commitUnreadSnapshot(next, { failed: false, stale: false });
}

/**
 * Зафиксировать, какой тред сейчас реально виден (Variant A policy).
 * Вызывает ChatThreadView при изменении gate.
 */
export function setActiveThreadContext(next: ActiveThreadContext): void {
  activeThreadContext = { ...next };
}

export function clearActiveThreadContext(): void {
  activeThreadContext = { ...EMPTY_ACTIVE_THREAD_CONTEXT };
}

export function getActiveThreadContextSnapshot(): ActiveThreadContext {
  return { ...activeThreadContext };
}

export type IngestIncomingMessageResult = {
  accept: boolean;
  bumpUnread: boolean;
  shouldMarkRead: boolean;
  reason: string;
};

/**
 * Атомарно: dedupe messageId + unread bump/suppress.
 * Сообщения в UI добавляет caller; mark-read — если shouldMarkRead.
 */
export function ingestIncomingChatMessage(
  event: IncomingChatMessageEvent,
): IngestIncomingMessageResult {
  const decision = decideIncomingChatMessage({
    event,
    active: activeThreadContext,
  });
  if (!decision.accept) {
    return {
      accept: false,
      bumpUnread: false,
      shouldMarkRead: false,
      reason: decision.reason,
    };
  }

  const prev = {
    chatCount,
    chatFailed,
    chatUnreadStale,
    inboxBadge,
    inboxItems,
    inboxWsConnected,
    revision: unreadSnapshot?.revision ?? 0,
  };

  const base = unreadSnapshot ?? snapshotFromThreads(chatThreads, Date.now());
  if (decision.bumpUnread) {
    const cur = base.threads.find((t) => t.id === event.threadId)?.unread_count ?? 0;
    commitUnreadSnapshot(
      patchThreadUnreadInSnapshot(base, event.threadId, cur + 1),
      { failed: false, stale: false },
    );
    refreshInboxChatRow(chatCount);
  } else if (decision.shouldMarkRead || decision.reason === 'applied_suppress') {
    // Явно держим 0 в той же транзакции (сервер мог уже успеть отдать +1)
    commitUnreadSnapshot(
      patchThreadUnreadInSnapshot(base, event.threadId, 0),
      { failed: false, stale: false },
    );
    refreshInboxChatRow(chatCount);
  }

  notifyIfChanged(prev);
  return {
    accept: true,
    bumpUnread: decision.bumpUnread,
    shouldMarkRead: decision.shouldMarkRead,
    reason: decision.reason,
  };
}

export function getChatUnreadSnapshot() {
  return { count: chatCount, failed: chatFailed, inboxWsConnected, stale: chatUnreadStale };
}

export function getChatUnreadCountSnapshot() {
  // Только global — для subscribe. UI должен брать selectChatUnread({ type: 'global' }).
  return selectChatUnread({ type: 'global' }).count;
}

export function getChatFailedSnapshot() {
  return chatFailed;
}

export function getChatUnreadStaleSnapshot() {
  return chatUnreadStale;
}

export function getChatUnreadRevisionSnapshot() {
  return unreadSnapshot?.revision ?? 0;
}

export function getInboxWsConnectedSnapshot() {
  return inboxWsConnected;
}

export function getChatInboxThreadsSnapshot(): ChatThread[] {
  return chatThreads;
}

/**
 * Unread с обязательным scope.
 * Запрещено читать count без области — используйте { type: 'global' } для dock/badge.
 */
export function selectChatUnread(
  scope: UnreadScope,
  labelOpts?: { projectName?: string },
): UnreadCountResult {
  return selectUnreadCount(
    scope,
    {
      threads: chatThreads,
      threadsComplete: true, // inbox snapshot — полный SoT
      globalTotal: chatCount,
    },
    labelOpts,
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

function notifyIfChanged(prev: {
  chatCount: number;
  chatFailed: boolean;
  chatUnreadStale: boolean;
  inboxBadge: number;
  inboxItems: InboxItem[];
  inboxWsConnected: boolean;
  revision: number;
}) {
  if (
    prev.chatCount === chatCount
    && prev.chatFailed === chatFailed
    && prev.chatUnreadStale === chatUnreadStale
    && prev.inboxBadge === inboxBadge
    && prev.inboxItems === inboxItems
    && prev.inboxWsConnected === inboxWsConnected
    && prev.revision === (unreadSnapshot?.revision ?? 0)
  ) {
    return;
  }
  notify();
}

/**
 * Загрузка unread snapshot без apply — apply только после guards (abort/context).
 */
async function fetchChatSnapshot(userId: string): Promise<
  | { ok: true; snapshot: ChatUnreadSnapshot }
  | { ok: false }
> {
  try {
    const raw = await api.chatInbox(userId);
    return { ok: true, snapshot: parseChatUnreadSnapshotApi(raw, Date.now()) };
  } catch {
    return { ok: false };
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
      i.kind === 'chat' ? { ...i, sub: `${formatUnreadCount(n)} во всех чатах` } : i,
    );
  } else {
    // Upsert: иначе dock уже показывает N, а «Входящие» без строки чата / со старым sub.
    const role = cachedFullSync?.osRole ?? 'customer';
    inboxItems = [
      {
        id: 'chat',
        kind: 'chat',
        title: 'Непрочитанные сообщения',
        sub: `${formatUnreadCount(n)} во всех чатах`,
        href: role === 'contractor' ? '/(contractor)/(tabs)/chat' : '/(customer)/(tabs)/chat',
        priority: 90,
      },
      ...inboxItems,
    ];
  }
  const taskRows = inboxItems.filter((i) => i.kind !== 'chat').length;
  inboxBadge = taskRows + n;
}

/** Точечное обновление unread треда — total пересчитывается в том же action */
function patchThreadReadLocal(threadId: string, threadUnread = 0) {
  const prev = {
    chatCount,
    chatFailed,
    chatUnreadStale,
    inboxBadge,
    inboxItems,
    inboxWsConnected,
    revision: unreadSnapshot?.revision ?? 0,
  };
  applyLocalThreadUnread(threadId, threadUnread);
  refreshInboxChatRow(chatCount);
  notifyIfChanged(prev);
}

/**
 * Локально архивировать/разархивировать тред с пересчётом total.
 */
export function patchThreadArchivedLocal(threadId: string, isArchived: boolean) {
  const prev = {
    chatCount,
    chatFailed,
    chatUnreadStale,
    inboxBadge,
    inboxItems,
    inboxWsConnected,
    revision: unreadSnapshot?.revision ?? 0,
  };
  const base = unreadSnapshot ?? snapshotFromThreads(chatThreads, Date.now());
  commitUnreadSnapshot(setThreadArchivedInSnapshot(base, threadId, isArchived), {
    failed: false,
    stale: false,
  });
  refreshInboxChatRow(chatCount);
  notifyIfChanged(prev);
}

/**
 * Единый mark-read: dedupe in-flight, ignore stale/same cursor,
 * точечный patch store; полный reload только при ошибке API.
 */
export async function markThreadRead(args: MarkThreadReadArgs): Promise<MarkThreadReadResult> {
  const {
    userId,
    projectId,
    threadId,
    throughMessageId = null,
    throughCreatedAt = null,
    userRole,
    source,
    force = false,
  } = args;

  const base = {
    threadId,
    throughMessageId,
    source,
  };

  const evalDecision = (hasInflight: boolean) =>
    decideMarkReadAction({
      force,
      throughMessageId,
      throughCreatedAt,
      confirmed: confirmedRead.get(threadId) ?? null,
      hasInflight,
    });

  // Уже есть in-flight → ждём и не стартуем второй API
  const existing = markInflight.get(threadId);
  if (existing) {
    recordMarkReadDiag({ ...base, outcome: 'deduplicated' });
    await existing;
    const after = evalDecision(false);
    if (after.action === 'skip_same') {
      recordMarkReadDiag({ ...base, outcome: 'skipped_same' });
      return { status: 'skipped_same', ...base };
    }
    if (after.action === 'skip_stale') {
      recordMarkReadDiag({ ...base, outcome: 'skipped_stale' });
      return { status: 'skipped_stale', ...base };
    }
    if (after.action === 'await_inflight') {
      return { status: 'deduplicated', ...base };
    }
    // более новый cursor — fall through к новому send
  } else {
    const early = evalDecision(false);
    if (early.action === 'skip_same') {
      recordMarkReadDiag({ ...base, outcome: 'skipped_same' });
      return { status: 'skipped_same', ...base };
    }
    if (early.action === 'skip_stale') {
      recordMarkReadDiag({ ...base, outcome: 'skipped_stale' });
      return { status: 'skipped_stale', ...base };
    }
  }

  // Атомарный claim слота до любого await I/O
  let resolveClaim!: (r: MarkThreadReadResult) => void;
  const claim = new Promise<MarkThreadReadResult>((res) => {
    resolveClaim = res;
  });
  // Если проиграли гонку — другой уже поставил promise
  if (markInflight.has(threadId)) {
    recordMarkReadDiag({ ...base, outcome: 'deduplicated' });
    await markInflight.get(threadId);
    const afterRace = evalDecision(false);
    if (afterRace.action === 'send') {
      // редкий случай: нужно отправить новый cursor — рекурсия с тем же args
      return markThreadRead(args);
    }
    const status = afterRace.action === 'skip_stale'
      ? 'skipped_stale' as const
      : afterRace.action === 'skip_same'
        ? 'skipped_same' as const
        : 'deduplicated' as const;
    recordMarkReadDiag({ ...base, outcome: status === 'deduplicated' ? 'deduplicated' : status });
    return { status, ...base };
  }
  markInflight.set(threadId, claim);

  try {
    patchThreadReadLocal(threadId, 0);
    recordMarkReadDiag({ ...base, outcome: 'patched' });

    try {
      const res = await api.markChatRead(userId, projectId, threadId, throughMessageId);
      chatFailed = false;
      const serverUnread = typeof res?.thread_unread_count === 'number' ? res.thread_unread_count : 0;
      const confirmedId = res?.read_through_message_id ?? throughMessageId;
      confirmedRead.set(threadId, {
        messageId: confirmedId ?? null,
        createdAt: throughCreatedAt,
      });
      // Total только из суммы тредов — не подставляем независимый server total
      patchThreadReadLocal(threadId, serverUnread);
      if (
        typeof res?.total_unread_count === 'number'
        && res.total_unread_count !== chatCount
        && (typeof __DEV__ === 'undefined' || __DEV__)
      ) {
        warnUnreadInvariantIfBroken(
          unreadSnapshot ?? snapshotFromThreads(chatThreads, Date.now()),
          undefined,
          'mark_read_server_total_mismatch',
        );
      }
      const ok: MarkThreadReadResult = { status: 'sent', ...base };
      recordMarkReadDiag({ ...base, outcome: 'sent' });
      resolveClaim(ok);
      return ok;
    } catch {
      recordMarkReadDiag({ ...base, outcome: 'error' });
      try {
        const { requestChatSync, patchChatSyncContext } = await import('@/lib/chatSync');
        patchChatSyncContext({
          userId,
          role: userRole ?? null,
          projectId: projectId ?? cachedFullSync?.projectId ?? null,
        });
        await requestChatSync({ scope: 'all', reason: 'manual', priority: 'high' });
      } catch {
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
      const err: MarkThreadReadResult = { status: 'error', ...base };
      resolveClaim(err);
      return err;
    }
  } finally {
    if (markInflight.get(threadId) === claim) {
      markInflight.delete(threadId);
    }
  }
}

/** @deprecated используйте markThreadRead */
export async function markChatReadAndSync(
  userId: string,
  projectId: string,
  threadId: string,
  userRole?: UserRole,
  _knownUnread = 0,
  readThroughMessageId?: string | null,
): Promise<void> {
  await markThreadRead({
    userId,
    projectId,
    threadId,
    throughMessageId: readThroughMessageId,
    userRole,
    source: 'manual',
  });
}

/** Сброс confirmed cursors (смена пользователя) */
export function clearMarkReadCursors(): void {
  confirmedRead.clear();
  markInflight.clear();
}

export function getConfirmedReadCursor(threadId: string): ConfirmedReadCursor | null {
  return confirmedRead.get(threadId) ?? null;
}

export async function reloadInboxSyncAfterChatRead(userId: string, userRole?: UserRole): Promise<void> {
  try {
    const { requestChatSync, patchChatSyncContext } = await import('@/lib/chatSync');
    patchChatSyncContext({ userId, role: userRole ?? null });
    await requestChatSync({ scope: 'all', reason: 'manual', priority: 'high' });
  } catch {
    await reloadInboxSync({ userId, userRole }, true);
  }
  emitInboxWs();
}

export type ReloadInboxSyncGuards = {
  signal?: AbortSignal;
  /** Ключ на старте запроса — сверить перед apply */
  contextKey?: string;
  getContextKey?: () => string;
};

function guardsAborted(guards?: ReloadInboxSyncGuards): boolean {
  if (guards?.signal?.aborted) return true;
  if (
    guards?.contextKey != null
    && guards.getContextKey
    && guards.contextKey !== guards.getContextKey()
  ) {
    return true;
  }
  return false;
}

/**
 * Низкоуровневый reload. Предпочтительный вход — `requestChatSync` (оркестратор).
 * guards: AbortSignal + context key — не применять ответ чужого/старого контекста.
 */
export async function reloadInboxSync(
  opts: {
    userId?: string;
    userRole?: UserRole;
    projectId?: string;
    project?: ProjectDetail | null;
    osRole?: OsRole;
  },
  force = false,
  guards?: ReloadInboxSyncGuards,
): Promise<void> {
  const merged = mergeReloadOpts(opts);
  const key = [merged.userId, merged.userRole, merged.projectId, merged.osRole].join(':');
  if (!force && reloadInflight && lastReloadKey === key) return reloadInflight;

  lastReloadKey = key;
  const generation = ++loadGeneration;
  reloadInflight = (async () => {
    const prev = {
      chatCount,
      chatFailed,
      chatUnreadStale,
      inboxBadge,
      inboxItems,
      inboxWsConnected,
      revision: unreadSnapshot?.revision ?? 0,
    };

    if (!merged.userId) {
      chatCount = 0;
      chatFailed = false;
      chatUnreadStale = false;
      chatThreads = [];
      unreadSnapshot = null;
      inboxItems = [];
      inboxBadge = 0;
      cachedFullSync = null;
      lastChatUserId = undefined;
      clearActiveThreadContext();
      clearIncomingMessageDedupe();
      clearMarkReadCursors();
      notifyIfChanged(prev);
      return;
    }

    // Смена пользователя: не показываем чужой unread до нового snapshot
    if (lastChatUserId && lastChatUserId !== merged.userId) {
      chatCount = 0;
      chatFailed = false;
      chatUnreadStale = false;
      chatThreads = [];
      unreadSnapshot = null;
      clearActiveThreadContext();
      clearIncomingMessageDedupe();
      clearMarkReadCursors();
    }
    lastChatUserId = merged.userId;

    if (guardsAborted(guards)) return;

    const chatState = await fetchChatSnapshot(merged.userId);
    if (generation !== loadGeneration || guardsAborted(guards)) return;
    if (chatState.ok) {
      applyIncomingSnapshot(chatState.snapshot, { force: true });
    } else {
      // Ошибка списка: не трогаем total отдельно — помечаем stale/failed
      chatFailed = chatThreads.length === 0 && chatCount === 0;
      chatUnreadStale = true;
      if (chatThreads.length === 0) {
        chatFailed = true;
      }
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
        if (generation !== loadGeneration || guardsAborted(guards)) return;
        // W78: локальная offline-очередь в том же inbox, что оплаты/приёмка
        try {
          const off = await getOfflineOutboxStatus();
          inboxItems = mergeOfflineInboxItem(inboxItems, off);
        } catch { /* noop */ }
        const taskRows = inboxItems.filter((i) => i.kind !== 'chat').length;
        inboxBadge = taskRows + chatCount;
      } catch {
        if (!inboxItems.length) {
          inboxBadge = chatCount;
        }
      }
    } else {
      // Нет projectId в этом вызове — не затираем задачи: только выравниваем чат с chatCount.
      refreshInboxChatRow(chatCount);
    }

    if (generation !== loadGeneration || guardsAborted(guards)) return;
    notifyIfChanged(prev);
  })();

  try {
    await reloadInflight;
  } finally {
    reloadInflight = null;
  }
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
  void import('@/lib/chatSync').then((m) => {
    m.setChatInboxWsConnected(false);
  }).catch(() => { /* test env */ });
}

function startInboxWebSocket(userId: string, _onReload: () => void) {
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
            void import('@/lib/chatSync').then((m) => {
              m.setChatInboxWsConnected(true);
            }).catch(() => { /* test env */ });
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
          // Нормализованное событие → orchestrator (debounce + coalesce), не прямой reload
          void import('@/lib/chatSync').then((m) => {
            m.onChatInboxWsEvent();
          }).catch(() => { /* test env */ });
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
            void import('@/lib/chatSync').then((m) => {
              m.setChatInboxWsConnected(false);
            }).catch(() => { /* test env */ });
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
          void import('@/lib/chatSync').then((m) => {
            m.setChatInboxWsConnected(false);
          }).catch(() => { /* test env */ });
        }
        attempt += 1;
        timer = setTimeout(connect, 4000);
      }
    })();
  };

  connect();

  return () => {
    alive = false;
    if (timer) clearTimeout(timer);
    if (pingTimer) clearInterval(pingTimer);
    stopPoll();
  };
}

/** Одно WS на пользователя — ref-counted. Sync через chatSync, не через onReload. */
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
    wsCleanup = startInboxWebSocket(userId, () => {});
  }

  wsRefCount += 1;
  return () => {
    wsRefCount = Math.max(0, wsRefCount - 1);
    if (wsRefCount === 0) stopInboxWebSocket();
  };
}

export { subscribeInboxWs, emitInboxWs };
