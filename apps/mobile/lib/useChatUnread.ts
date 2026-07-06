/** Счётчик непрочитанных сообщений для badge в dock и шапке */
import { useCallback, useState, useEffect } from 'react';
import { useFocusEffect } from 'expo-router';
import { api } from '@/lib/api';
import type { UserRole } from '@/lib/api';
import { inboxAttentionTotal } from '@/lib/chatAttention';
import { useInboxWebSocket } from '@/lib/useInboxWebSocket';
import { emitInboxWs, subscribeInboxWs } from '@/lib/inboxWsBus';

const POLL_MS = 25_000;

/** Подписка на inbox WS — колбэк при новых сообщениях / emitInboxWs */
export function useInboxWsListener(onPush: () => void) {
  useEffect(() => subscribeInboxWs(onPush), [onPush]);
}

function sumThreadUnread(threads: { unread_count?: number }[]): number {
  return threads.reduce((acc, t) => acc + (t.unread_count || 0), 0);
}

export function useChatUnread(userId?: string, viewerRole?: UserRole) {
  const [count, setCount] = useState(0);
  const [failed, setFailed] = useState(false);

  const reload = useCallback(async () => {
    if (!userId) { setCount(0); setFailed(false); return; }
    let total = 0;
    let apiOk = false;
    try {
      const r = await api.chatUnreadTotal(userId);
      total = r.count || 0;
      apiOk = true;
    } catch {
      apiOk = false;
    }
    try {
      const inbox = await api.chatInbox(userId);
      const fromThreads = sumThreadUnread(inbox);
      const attention = inboxAttentionTotal(
        inbox.filter((t) => !t.is_archived),
        viewerRole === 'contractor' ? 'contractor' : viewerRole === 'customer' ? 'customer' : undefined,
      );
      total = Math.max(total, fromThreads, attention);
      apiOk = true;
    } catch {
      /* keep prior total if inbox fails too */
    }
    setCount(total);
    setFailed(!apiOk && total === 0);
  }, [userId, viewerRole]);

  useFocusEffect(useCallback(() => { reload().catch(() => {}); }, [reload]));

  const { connected: inboxWs } = useInboxWebSocket(userId, !!userId, () => {
    reload().catch(() => {});
    emitInboxWs();
  });

  useEffect(() => {
    if (!userId) return;
    const ms = inboxWs ? 60_000 : POLL_MS;
    const id = setInterval(() => { reload().catch(() => {}); }, ms);
    return () => clearInterval(id);
  }, [userId, reload, inboxWs]);

  return { count, reload, inboxWsConnected: inboxWs, failed };
}
