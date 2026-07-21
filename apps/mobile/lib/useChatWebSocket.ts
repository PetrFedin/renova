/** WebSocket чата — reconnect с backoff, fallback polling когда offline */
import { useEffect, useRef, useCallback, useState } from 'react';
import { getAccessToken } from '@/lib/api/client';

type ChatWsPayload = { type?: string; message?: unknown };

export function useChatWebSocket(
  threadId: string | undefined,
  enabled: boolean,
  onEvent: (payload: ChatWsPayload) => void,
) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!threadId || !enabled) {
      setConnected(false);
      return;
    }

    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    const connect = () => {
      if (!alive) return;
      const base = (process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:8100').replace(/^http/, 'ws');
      try {
        const tok = getAccessToken();
        const qs = tok ? `?token=${encodeURIComponent(tok)}` : '';
        const ws = new WebSocket(`${base}/ws/chats/${threadId}${qs}`);
        wsRef.current = ws;
        ws.onopen = () => {
          attempt = 0;
          if (alive) setConnected(true);
        };
        ws.onmessage = (e) => {
          try {
            onEventRef.current(JSON.parse(e.data) as ChatWsPayload);
          } catch {
            onEventRef.current({});
          }
        };
        ws.onerror = () => { ws.close(); };
        ws.onclose = () => {
          wsRef.current = null;
          if (alive) setConnected(false);
          if (!alive) return;
          attempt += 1;
          const delay = Math.min(30000, 2000 * 2 ** Math.min(attempt - 1, 4));
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
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [threadId, enabled]);

  const send = useCallback((payload: object) => {
    try {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify(payload));
      }
    } catch { /* noop */ }
  }, []);

  return { send, connected };
}

/** Fallback polling — только когда WS не подключён */
export function useChatFallbackPoll(active: boolean, intervalMs: number, tick: () => void) {
  const tickRef = useRef(tick);
  tickRef.current = tick;
  useEffect(() => {
    if (!active) return;
    tickRef.current();
    const id = setInterval(() => tickRef.current(), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);
}
