/** Хуки unread/inbox — единый inboxSyncStore */
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { useFocusEffect } from 'expo-router';
import type { UserRole } from '@/lib/api';
import {
  ensureInboxWebSocket,
  getChatFailedSnapshot,
  getChatInboxThreadsSnapshot,
  getChatUnreadCountSnapshot,
  getInboxHealthSnapshot,
  getInboxItemsSnapshot,
  getInboxWsConnectedSnapshot,
  reloadInboxSync,
  markChatReadAndSync,
  subscribeInboxSync,
  subscribeInboxWs,
} from '@/lib/inboxSyncStore';
import { inboxAttentionBadge, inboxTaskBadge } from '@/lib/domain/buildInboxItems';
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

export { useInboxWsConnected };

function useInboxItems() {
  return useSyncExternalStore(subscribeInboxSync, getInboxItemsSnapshot, getInboxItemsSnapshot);
}

function useInboxHealth() {
  return useSyncExternalStore(subscribeInboxSync, getInboxHealthSnapshot, getInboxHealthSnapshot);
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
    async (projectId: string, threadId: string, readThroughMessageId: string) => {
      if (!userId || !projectId || !threadId || !readThroughMessageId) return;
      await markChatReadAndSync(
        userId,
        projectId,
        threadId,
        readThroughMessageId,
        userRole,
      );
    }, [userId, userRole],
  );
}

/** Задачи «Входящие» + единый badge (задачи + непрочитанные сообщения) */
export function useInboxTasks(role: OsRole) {
  const { user, activeProject } = useRenova();
  const items = useInboxItems();
  const health = useInboxHealth();
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
      reload().catch(reportCatch('inboxTasks.reload.focus'));
    }, [reload]),
  );

  useInboxWsListener(
    useCallback(() => {
      reload().catch(reportCatch('inboxTasks.reload.bus'));
    }, [reload]),
  );

  useEffect(() => {
    if (!user?.id) return undefined;
    return ensureInboxWebSocket(user.id, () => {
      reload().catch(reportCatch('inboxTasks.reload.websocket'));
    });
  }, [user?.id, reload]);

  // W79: после flush offline — пересобрать inbox (в т.ч. offline-строку)
  useEffect(() => subscribeOfflineFlush(() => {
    reload().catch(reportCatch('inboxTasks.reload.offlineFlush'));
  }), [reload]);

  // W88: projectDataBus (мутации golden path) → badges «Входящие»/«Ещё» без focus
  useEffect(() => subscribeProjectDataChanged(() => {
    reload().catch(reportCatch('inboxTasks.reload.projectData'));
  }), [reload]);

  // W81: смена объекта → inbox/задачи текущего projectId (не ждать blur/focus)
  useEffect(() => {
    reload().catch(reportCatch('inboxTasks.reload.context'));
  }, [reload]);

  return { items, health, badge, taskBadge, chatUnread, reload };
}

function useChatInboxThreadsSnapshot() {
  return useSyncExternalStore(subscribeInboxSync, getChatInboxThreadsSnapshot, getChatInboxThreadsSnapshot);
}

/** Список чатов из store — синхронен с badge; stale thread list не считается успешным reload. */
export function useChatInboxThreads(userId?: string, userRole?: UserRole) {
  const threads = useChatInboxThreadsSnapshot();
  const reload = useCallback(async () => {
    await reloadInboxSync({ userId, userRole });
    if (getChatFailedSnapshot()) {
      throw new Error('chat_inbox_refresh_degraded');
    }
  }, [userId, userRole]);
  return { threads, reload };
}