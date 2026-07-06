/** WebSocket inbox — обновление списка чатов и badge без polling */
import { useEffect, useRef, useState } from 'react';

type InboxWsPayload = { type?: string; event?: string; thread_id?: string; project_id?: string };

export function useInboxWebSocket(
  userId: string | undefined,
  enabled: boolean,
  onEvent: (payload: InboxWsPayload) => void,
) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!userId || !enabled) {
      setConnected(false);
      return;
    }

    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let pingTimer: ReturnType<typeof setInterval> | null = null;

    const connect = () => {
      if (!alive) return;
      const base = (process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:8100').replace(/^http/, 'ws');
      try {
        const ws = new WebSocket(`${base}/ws/inbox/${userId}`);
        ws.onopen = () => {
          attempt = 0;
          if (alive) setConnected(true);
          pingTimer = setInterval(() => {
            try {
              if (ws.readyState === WebSocket.OPEN) ws.send('ping');
            } catch { /* noop */ }
          }, 25_000);
        };
        ws.onmessage = (e) => {
          if (e.data === 'ping' || e.data === 'pong') return;
          try {
            onEventRef.current(JSON.parse(e.data) as InboxWsPayload);
          } catch {
            onEventRef.current({});
          }
        };
        ws.onerror = () => { ws.close(); };
        ws.onclose = () => {
          if (pingTimer) clearInterval(pingTimer);
          pingTimer = null;
          if (alive) setConnected(false);
          if (!alive) return;
          attempt += 1;
          const delay = Math.min(30_000, 2000 * 2 ** Math.min(attempt - 1, 4));
          timer = setTimeout(connect, delay);
        };
      } catch {
        if (alive) setConnected(false);
        attempt += 1;
        timer = setTimeout(connect, 4000);
      }
    };

    connect();
    return () => {
      alive = false;
      setConnected(false);
      if (timer) clearTimeout(timer);
      if (pingTimer) clearInterval(pingTimer);
    };
  }, [userId, enabled]);

  return { connected };
}
