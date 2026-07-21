/** Хуки unread/inbox — единый chatSync orchestrator → inboxSyncStore */
import { useCallback, useEffect, useRef, useSyncExternalStore, useMemo } from 'react';
import { useFocusEffect } from 'expo-router';
import type { UserRole } from '@/lib/api';
import {
  ensureInboxWebSocket,
  getChatFailedSnapshot,
  getChatInboxThreadsSnapshot,
  getChatUnreadCountSnapshot,
  getChatUnreadStaleSnapshot,
  getInboxItemsSnapshot,
  getInboxWsConnectedSnapshot,
  markThreadRead,
  selectChatUnread,
  subscribeInboxSync,
  subscribeInboxWs,
} from '@/lib/inboxSyncStore';
import type { UnreadScope } from '@/lib/domain/unreadScope';
import {
  requestChatSync,
  patchChatSyncContext,
  logoutChatSync,
} from '@/lib/chatSync';
import { inboxAttentionBadge, inboxTaskBadge } from '@/lib/domain/buildInboxItems';
import type { MarkThreadReadSource } from '@/lib/domain/markThreadReadPolicy';
import type { OsRole } from '@/constants/osSections';
import { useRenova } from '@/lib/context/RenovaContext';
import { subscribeOfflineFlush } from '@/lib/offline';
import { subscribeProjectDataChanged } from '@/lib/projectDataBus';
import { reportCatch } from '@/lib/reportError';

export function useInboxWsListener(onPush: () => void) {
  useEffect(() => subscribeInboxWs(onPush), [onPush]);
}

function useChatUnreadCount() {
  return useSyncExternalStore(subscribeInboxSync, getChatUnreadCountSnapshot, getChatUnreadCountSnapshot);
}

function useChatFailed() {
  return useSyncExternalStore(subscribeInboxSync, getChatFailedSnapshot, getChatFailedSnapshot);
}

function useChatUnreadStale() {
  return useSyncExternalStore(subscribeInboxSync, getChatUnreadStaleSnapshot, getChatUnreadStaleSnapshot);
}

function useInboxWsConnected() {
  return useSyncExternalStore(subscribeInboxSync, getInboxWsConnectedSnapshot, getInboxWsConnectedSnapshot);
}

function useInboxItems() {
  return useSyncExternalStore(subscribeInboxSync, getInboxItemsSnapshot, getInboxItemsSnapshot);
}

export function useChatUnread(userId?: string, userRole?: UserRole) {
  const count = useChatUnreadCount();
  const failed = useChatFailed();
  const stale = useChatUnreadStale();
  const inboxWsConnected = useInboxWsConnected();

  useEffect(() => {
    if (!userId) {
      logoutChatSync();
      return;
    }
    patchChatSyncContext({
      userId,
      role: userRole ?? null,
    });
  }, [userId, userRole]);

  const reload = useCallback(async () => {
    if (!userId) return;
    patchChatSyncContext({ userId, role: userRole ?? null });
    await requestChatSync({ scope: 'all', reason: 'manual', priority: 'high' });
  }, [userId, userRole]);

  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      patchChatSyncContext({ userId, role: userRole ?? null });
      void requestChatSync({ scope: 'all', reason: 'focus' }).catch(reportCatch('chatUnread.reload'));
    }, [userId, userRole]),
  );

  useEffect(() => {
    if (!userId) return undefined;
    // WS → onChatInboxWsEvent внутри store; onReload больше не нужен
    return ensureInboxWebSocket(userId);
  }, [userId]);

  // Dock / глобальный badge — всегда явный global scope
  return {
    count,
    scope: { type: 'global' } as const,
    scopeLabel: 'все чаты',
    reload,
    inboxWsConnected,
    failed,
    stale,
  };
}

/**
 * Unread для произвольного scope (project / filter / thread).
 * Глобальный badge не меняется при смене scope — только возвращаемый count.
 */
export function useScopedChatUnread(scope: UnreadScope, labelOpts?: { projectName?: string }) {
  const threads = useSyncExternalStore(
    subscribeInboxSync,
    getChatInboxThreadsSnapshot,
    getChatInboxThreadsSnapshot,
  );
  const globalCount = useChatUnreadCount();
  const stale = useChatUnreadStale();
  const scopeKey = JSON.stringify(scope);
  const projectName = labelOpts?.projectName;
  return useMemo(() => {
    const parsed = JSON.parse(scopeKey) as UnreadScope;
    const result = selectChatUnread(parsed, projectName ? { projectName } : undefined);
    return { ...result, stale, globalCount };
  }, [scopeKey, projectName, threads, globalCount, stale]);
}

export function useChatReadSync(userId?: string, userRole?: UserRole) {
  return useCallback(
    async (
      projectId: string,
      threadId: string,
      _knownUnread = 0,
      readThroughMessageId?: string | null,
      throughCreatedAt?: string | null,
      source: MarkThreadReadSource = 'thread_visible',
    ) => {
      if (!userId || !projectId || !threadId) return;
      await markThreadRead({
        userId,
        projectId,
        threadId,
        throughMessageId: readThroughMessageId,
        throughCreatedAt,
        userRole,
        source,
      });
    },
    [userId, userRole],
  );
}

/** Задачи «Входящие» + единый badge (задачи + непрочитанные сообщения) */
export function useInboxTasks(role: OsRole) {
  const { user, activeProject } = useRenova();
  const items = useInboxItems();
  const chatUnread = useChatUnreadCount();
  const taskBadge = inboxTaskBadge(items);
  const badge = inboxAttentionBadge(items, chatUnread);
  const projectId = activeProject?.id;
  const projectRef = useRef(activeProject);
  projectRef.current = activeProject;

  useEffect(() => {
    if (!user?.id) {
      logoutChatSync();
      return;
    }
    patchChatSyncContext({
      userId: user.id,
      role: role ?? user.role ?? null,
      projectId: projectId ?? null,
    });
  }, [user?.id, user?.role, role, projectId]);

  const reload = useCallback(async () => {
    if (!user?.id) return;
    patchChatSyncContext({
      userId: user.id,
      role: role ?? user.role ?? null,
      projectId: projectId ?? null,
    });
    await requestChatSync({ scope: 'all', reason: 'manual', priority: 'high' });
  }, [user?.id, user?.role, projectId, role]);

  useFocusEffect(
    useCallback(() => {
      if (!user?.id) return;
      patchChatSyncContext({
        userId: user.id,
        role: role ?? user.role ?? null,
        projectId: projectId ?? null,
      });
      void requestChatSync({ scope: 'all', reason: 'focus' }).catch(reportCatch('chatUnread.reload'));
    }, [user?.id, user?.role, projectId, role]),
  );

  // WS bus: sync уже в orchestrator через onChatInboxWsEvent — не дублируем reload.

  useEffect(() => {
    if (!user?.id) return undefined;
    return ensureInboxWebSocket(user.id);
  }, [user?.id]);

  // W79: после flush — один reconciliation через orchestrator
  useEffect(() => subscribeOfflineFlush(() => {
    if (!user?.id) return;
    patchChatSyncContext({
      userId: user.id,
      role: role ?? user.role ?? null,
      projectId: projectId ?? null,
    });
    void requestChatSync({ scope: 'all', reason: 'offline_flush', priority: 'high' })
      .catch(reportCatch('chatUnread.reload'));
  }), [user?.id, user?.role, projectId, role]);

  // W88: projectDataBus → один sync (coalesce), не независимая цепочка
  useEffect(() => subscribeProjectDataChanged(() => {
    if (!user?.id) return;
    void requestChatSync({ scope: 'all', reason: 'project_change', priority: 'high' })
      .catch(reportCatch('chatUnread.reload'));
  }), [user?.id]);

  // W81: смена объекта → context + sync
  useEffect(() => {
    if (!user?.id) return;
    patchChatSyncContext({
      userId: user.id,
      role: role ?? user.role ?? null,
      projectId: projectId ?? null,
    });
    void requestChatSync({ scope: 'all', reason: 'project_change', priority: 'high' })
      .catch(reportCatch('chatUnread.reload'));
  }, [user?.id, user?.role, projectId, role]);

  return { items, badge, taskBadge, chatUnread, reload };
}

function useChatInboxThreadsSnapshot() {
  return useSyncExternalStore(subscribeInboxSync, getChatInboxThreadsSnapshot, getChatInboxThreadsSnapshot);
}

/** Список чатов из store — синхронен с badge */
export function useChatInboxThreads(userId?: string, userRole?: UserRole) {
  const threads = useChatInboxThreadsSnapshot();
  const reload = useCallback(async () => {
    if (!userId) return;
    patchChatSyncContext({ userId, role: userRole ?? null });
    await requestChatSync({ scope: 'all', reason: 'manual', priority: 'high' });
  }, [userId, userRole]);
  return { threads, reload };
}
