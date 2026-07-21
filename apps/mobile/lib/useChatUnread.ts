/**
 * Хуки unread/inbox — только подписка на store + requestInboxSync.
 * Не создают собственные WebSocket / polling.
 */
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { useFocusEffect } from 'expo-router';
import { AppState, type AppStateStatus } from 'react-native';
import type { UserRole } from '@/lib/api';
import {
  ensureInboxWebSocket,
  findThreadProjectId,
  getChatFailedSnapshot,
  getChatInboxThreadsSnapshot,
  getChatUnreadCountSnapshot,
  getInboxItemsSnapshot,
  getInboxWsConnectedSnapshot,
  getMarkReadSyncFailedSnapshot,
  markThreadRead,
  requestInboxSync,
  subscribeInboxSync,
  type MarkReadResult,
} from '@/lib/inboxSyncStore';
import { inboxTaskBadge } from '@/lib/domain/buildInboxItems';
import type { OsRole } from '@/constants/osSections';
import { useRenova } from '@/lib/context/RenovaContext';
import { subscribeOfflineFlush } from '@/lib/offline';
import { subscribeProjectDataChanged } from '@/lib/projectDataBus';
import { reportCatch } from '@/lib/reportError';

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

function useMarkReadSyncFailed() {
  return useSyncExternalStore(subscribeInboxSync, getMarkReadSyncFailedSnapshot, getMarkReadSyncFailedSnapshot);
}

export function useChatUnread(userId?: string, userRole?: UserRole) {
  const count = useChatUnreadCount();
  const failed = useChatFailed();
  const inboxWsConnected = useInboxWsConnected();
  const markReadSyncFailed = useMarkReadSyncFailed();

  const reload = useCallback(async () => {
    if (!userId) return;
    await requestInboxSync({ reason: 'manual', userId, userRole });
  }, [userId, userRole]);

  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      void requestInboxSync({ reason: 'focus', userId, userRole }).catch(reportCatch('chatUnread.focus'));
    }, [userId, userRole]),
  );

  useEffect(() => {
    if (!userId) return undefined;
    return ensureInboxWebSocket(userId);
  }, [userId]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active' && userId) {
        void requestInboxSync({ reason: 'foreground', userId, userRole }).catch(reportCatch('chatUnread.fg'));
      }
    });
    return () => sub.remove();
  }, [userId, userRole]);

  return { count, reload, inboxWsConnected, failed, markReadSyncFailed };
}

export function useChatReadSync(userId?: string, userRole?: UserRole) {
  return useCallback(
    async (projectId: string, threadId: string, knownUnread = 0): Promise<MarkReadResult | void> => {
      if (!userId || !projectId || !threadId) return;
      return markThreadRead(userId, projectId, threadId, userRole, knownUnread);
    },
    [userId, userRole],
  );
}

/**
 * Задачи «Входящие»: taskBadge отдельно от chatUnread.
 * Смешанный attention badge удалён из UI-контракта.
 */
export function useInboxTasks(role: OsRole) {
  const { user, activeProject } = useRenova();
  const items = useInboxItems();
  const chatUnread = useChatUnreadCount();
  const taskBadge = inboxTaskBadge(items);
  const markReadSyncFailed = useMarkReadSyncFailed();
  const projectId = activeProject?.id;
  const projectRef = useRef(activeProject);
  projectRef.current = activeProject;

  const sync = useCallback(async (reason: 'focus' | 'manual' | 'offline_flush' | 'project_change' | 'initial') => {
    if (!user?.id) return;
    await requestInboxSync({
      reason,
      userId: user.id,
      userRole: user.role,
      projectId,
      project: projectRef.current,
      osRole: role,
    });
  }, [user?.id, user?.role, projectId, role]);

  useFocusEffect(
    useCallback(() => {
      void sync('focus').catch(reportCatch('inboxTasks.focus'));
    }, [sync]),
  );

  useEffect(() => {
    if (!user?.id) return undefined;
    return ensureInboxWebSocket(user.id);
  }, [user?.id]);

  useEffect(() => subscribeOfflineFlush(() => {
    void sync('offline_flush').catch(reportCatch('inboxTasks.flush'));
  }), [sync]);

  useEffect(() => subscribeProjectDataChanged(() => {
    void sync('project_change').catch(reportCatch('inboxTasks.bus'));
  }), [sync]);

  useEffect(() => {
    void sync('initial').catch(reportCatch('inboxTasks.project'));
  }, [sync]);

  return {
    items,
    taskBadge,
    chatUnread,
    markReadSyncFailed,
    reload: () => sync('manual'),
  };
}

function useChatInboxThreadsSnapshot() {
  return useSyncExternalStore(subscribeInboxSync, getChatInboxThreadsSnapshot, getChatInboxThreadsSnapshot);
}

export function useChatInboxThreads(userId?: string, userRole?: UserRole) {
  const threads = useChatInboxThreadsSnapshot();
  const reload = useCallback(async () => {
    if (!userId) return;
    await requestInboxSync({ reason: 'manual', userId, userRole });
  }, [userId, userRole]);
  return { threads, reload, findThreadProjectId };
}

/** @deprecated store сам обрабатывает WS — не создавайте вторую цепочку reload */
export function useInboxWsListener(_onPush: () => void) {
  useEffect(() => () => {}, []);
}
