/** Счётчик непрочитанных сообщений для badge в dock и шапке */
import { useCallback, useState, useEffect } from 'react';
import { useFocusEffect } from 'expo-router';
import { api } from '@/lib/api';
import { useInboxWebSocket } from '@/lib/useInboxWebSocket';
import { emitInboxWs, subscribeInboxWs } from '@/lib/inboxWsBus';

const POLL_MS = 25_000;

/** Подписка на inbox WS — колбэк при новых сообщениях / emitInboxWs */
export function useInboxWsListener(onPush: () => void) {
  useEffect(() => subscribeInboxWs(onPush), [onPush]);
}

export function useChatUnread(userId?: string) {
  const [count, setCount] = useState(0);

  const reload = useCallback(async () => {
    if (!userId) { setCount(0); return; }
    try {
      const r = await api.chatUnreadTotal(userId);
      setCount(r.count || 0);
    } catch {
      setCount(0);
    }
  }, [userId]);

  useFocusEffect(useCallback(() => { reload().catch(() => {}); }, [reload]));

  const { connected: inboxWs } = useInboxWebSocket(userId, !!userId, () => {
    reload().catch(() => {});
    emitInboxWs();
  });

  /** Fallback polling — реже, если inbox WS подключён */
  useEffect(() => {
    if (!userId) return;
    const ms = inboxWs ? 60_000 : POLL_MS;
    const id = setInterval(() => { reload().catch(() => {}); }, ms);
    return () => clearInterval(id);
  }, [userId, reload, inboxWs]);

  return { count, reload, inboxWsConnected: inboxWs };
}
