/** Хуки unread/inbox — единый inboxSyncStore */
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { useFocusEffect } from 'expo-router';
import type { UserRole } from '@/lib/api';
import {
  ensureInboxWebSocket,
  getChatFailedSnapshot,
  getChatInboxThreadsSnapshot,
  getChatUnreadCountSnapshot,
  getInboxCountersSnapshot,
  getInboxItemsSnapshot,
  getInboxWsConnectedSnapshot,
  reloadInboxSync,
  markChatReadAndSync,
  subscribeInboxSync,
  subscribeInboxWs,
} from '@/lib/inboxSyncStore';
import { inboxActionItemTotal, type InboxCounters } from '@/lib/domain/inboxCounters';
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

function useInboxWsConnected() {
  return useSyncExternalStore(subscribeInboxSync, getInboxWsConnectedSnapshot, getInboxWsConnectedSnapshot);
}

function useInboxItems() {
  return useSyncExternalStore(subscribeInboxSync, getInboxItemsSnapshot, getInboxItemsSnapshot);
}

function useInboxCounters(): InboxCounters {
  return useSyncExternalStore(subscribeInboxSync, getInboxCountersSnapshot, getInboxCountersSnapshot);
}

export function useChatUnread(userId?: string, userRole?: UserRole) {
  const count = useChatUnreadCount();
  const failed = useChatFailed();
  const inboxWsConnected = useInboxWsConnected();

  const reload = useCallback(async () => {
    await reloadInboxSync({ userId, userRole });
  }, [userId, userRole]);

  useFocusEffect(
    useCallback(() => {
      reload().catch(reportCatch('chatUnread.reload'));
    }, [reload]),
  );

  useEffect(() => {
    if (!userId) return undefined;
    return ensureInboxWebSocket(userId, () => {
      reload().catch(reportCatch('chatUnread.reload'));
    });
  }, [userId, reload]);

  return { count, reload, inboxWsConnected, failed };
}

export function useChatReadSync(userId?: string, userRole?: UserRole) {
  return useCallback(
    async (projectId: string, threadId: string, knownUnread = 0) => {
      if (!userId || !projectId || !threadId) return;
      await markChatReadAndSync(userId, projectId, threadId, userRole, knownUnread);
    },
    [userId, userRole],
  );
}

/** Задачи «Входящие» + структурированные InboxCounters (без смешивания единиц) */
export function useInboxTasks(role: OsRole) {
  const { user, activeProject } = useRenova();
  const items = useInboxItems();
  const counters = useInboxCounters();
  const chatUnread = counters.unreadMessages;
  /** Action-единицы без сообщений */
  const taskBadge = inboxActionItemTotal(counters);
  /**
   * @deprecated не использовать как «всего дел»: это число категорий с активностью.
   * Для UI предпочитайте `counters`.
   */
  const badge = counters.totalActionGroups;
  const projectId = activeProject?.id;
  const projectRef = useRef(activeProject);
  projectRef.current = activeProject;

  const reload = useCallback(async () => {
    await reloadInboxSync({
      userId: user?.id,
      userRole: user?.role,
      projectId,
      project: projectRef.current,
      osRole: role,
    });
  }, [user?.id, user?.role, projectId, role]);

  useFocusEffect(
    useCallback(() => {
      reload().catch(reportCatch('chatUnread.reload'));
    }, [reload]),
  );

  useInboxWsListener(
    useCallback(() => {
      reload().catch(reportCatch('chatUnread.reload'));
    }, [reload]),
  );

  useEffect(() => {
    if (!user?.id) return undefined;
    return ensureInboxWebSocket(user.id, () => {
      reload().catch(reportCatch('chatUnread.reload'));
    });
  }, [user?.id, reload]);

  useEffect(() => subscribeOfflineFlush(() => {
    reload().catch(reportCatch('chatUnread.reload'));
  }), [reload]);

  useEffect(() => subscribeProjectDataChanged(() => {
    reload().catch(reportCatch('chatUnread.reload'));
  }), [reload]);

  useEffect(() => {
    reload().catch(reportCatch('chatUnread.reload'));
  }, [reload]);

  return { items, badge, taskBadge, chatUnread, counters, reload };
}

function useChatInboxThreadsSnapshot() {
  return useSyncExternalStore(subscribeInboxSync, getChatInboxThreadsSnapshot, getChatInboxThreadsSnapshot);
}

/** Список чатов из store — синхронен с badge */
export function useChatInboxThreads(userId?: string, userRole?: UserRole) {
  const threads = useChatInboxThreadsSnapshot();
  const reload = useCallback(async () => {
    await reloadInboxSync({ userId, userRole });
  }, [userId, userRole]);
  return { threads, reload };
}
