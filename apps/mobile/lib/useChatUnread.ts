/** Хуки unread/inbox — единый inboxSyncStore */
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { useFocusEffect } from 'expo-router';
import type { UserRole } from '@/lib/api';
import {
  ensureInboxWebSocket,
  getChatFailedSnapshot,
  getChatInboxThreadsSnapshot,
  getChatUnreadCountSnapshot,
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

export function useChatUnread(userId?: string, userRole?: UserRole) {
  const count = useChatUnreadCount();
  const failed = useChatFailed();
  const inboxWsConnected = useInboxWsConnected();

  const reload = useCallback(async () => {
    await reloadInboxSync({ userId, userRole });
  }, [userId, userRole]);

  useFocusEffect(
    useCallback(() => {
      reload().catch(() => {});
    }, [reload]),
  );

  useEffect(() => {
    if (!userId) return undefined;
    return ensureInboxWebSocket(userId, () => {
      reload().catch(() => {});
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
      reload().catch(() => {});
    }, [reload]),
  );

  useInboxWsListener(
    useCallback(() => {
      reload().catch(() => {});
    }, [reload]),
  );

  useEffect(() => {
    if (!user?.id) return undefined;
    return ensureInboxWebSocket(user.id, () => {
      reload().catch(() => {});
    });
  }, [user?.id, reload]);

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
