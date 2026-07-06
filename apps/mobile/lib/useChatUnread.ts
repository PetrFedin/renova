/** Хуки unread/inbox — читают единый inboxSyncStore (один WS, один reload) */
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { useFocusEffect } from 'expo-router';
import type { UserRole } from '@/lib/api';
import {
  ensureInboxWebSocket,
  getChatFailedSnapshot,
  getChatUnreadCountSnapshot,
  getInboxBadgeSnapshot,
  getInboxItemsSnapshot,
  getInboxWsConnectedSnapshot,
  reloadInboxSync,
  markChatReadAndSync,
  subscribeInboxSync,
  subscribeInboxWs,
} from '@/lib/inboxSyncStore';
import type { OsRole } from '@/constants/osSections';
import { useRenova } from '@/lib/context/RenovaContext';

/** Подписка на inbox WS — колбэк при новых сообщениях / emitInboxWs */
export function useInboxWsListener(onPush: () => void) {
  useEffect(() => subscribeInboxWs(onPush), [onPush]);
}

/** Примитивные snapshot-функции — без новых object-ссылок на каждый render */
function useChatUnreadCount() {
  return useSyncExternalStore(subscribeInboxSync, getChatUnreadCountSnapshot, getChatUnreadCountSnapshot);
}

function useChatFailed() {
  return useSyncExternalStore(subscribeInboxSync, getChatFailedSnapshot, getChatFailedSnapshot);
}

function useInboxWsConnected() {
  return useSyncExternalStore(subscribeInboxSync, getInboxWsConnectedSnapshot, getInboxWsConnectedSnapshot);
}

function useInboxBadge() {
  return useSyncExternalStore(subscribeInboxSync, getInboxBadgeSnapshot, getInboxBadgeSnapshot);
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

/** После markChatRead — дождаться сервера и обновить все badge */
export function useChatReadSync(userId?: string, userRole?: UserRole) {
  return useCallback(
    async (projectId: string, threadId: string, knownUnread = 0) => {
      if (!userId || !projectId || !threadId) return;
      await markChatReadAndSync(userId, projectId, threadId, userRole, knownUnread);
    },
    [userId, userRole],
  );
}

/** Задачи «Входящие» + badge — синхронизированы с chat attention и /inbox */
export function useInboxTasks(role: OsRole) {
  const { user, activeProject } = useRenova();
  const items = useInboxItems();
  const badge = useInboxBadge();
  const chatUnread = useChatUnreadCount();
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

  return { items, badge, chatUnread, reload };
}
