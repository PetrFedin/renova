/** Хуки unread/inbox — единый inboxSyncStore */
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
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
  reloadInboxSync,
  markThreadRead,
  subscribeInboxSync,
  subscribeInboxWs,
} from '@/lib/inboxSyncStore';
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

  return { count, reload, inboxWsConnected, failed, stale };
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

  // W79: после flush offline — пересобрать inbox (в т.ч. offline-строку)
  useEffect(() => subscribeOfflineFlush(() => {
    reload().catch(reportCatch('chatUnread.reload'));
  }), [reload]);

  // W88: projectDataBus (мутации golden path) → badges «Входящие»/«Ещё» без focus
  useEffect(() => subscribeProjectDataChanged(() => {
    reload().catch(reportCatch('chatUnread.reload'));
  }), [reload]);

  // W81: смена объекта → inbox/задачи текущего projectId (не ждать blur/focus)
  useEffect(() => {
    reload().catch(reportCatch('chatUnread.reload'));
  }, [reload]);

  return { items, badge, taskBadge, chatUnread, reload };
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
