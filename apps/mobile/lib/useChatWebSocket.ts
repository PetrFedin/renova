/** WebSocket чата — reconnect с backoff, fallback polling когда offline */
import { useEffect, useRef, useCallback, useState } from 'react';
import { buildWsAuthQuery } from '@/lib/wsAuthQuery';
import { isPollingPaused, pollingResumesInMs } from '@/lib/api/client';
import { classifyWsTicketFailure, nextWsDelayMs, wsReconnectDelayMs } from '@/lib/chatWsBackoff';

type ChatWsPayload = { type?: string; message?: unknown; message_id?: unknown; [key: string]: unknown };

export function useChatWebSocket(
  threadId: string | undefined,
  enabled: boolean,
  onEvent: (payload: ChatWsPayload) => void,
  /** Вызывается при ПЕРЕподключении: пока сокет был закрыт, кадры могли пропасть — догрузить историю. */
  onReconnect?: () => void,
) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const onReconnectRef = useRef(onReconnect);
  onReconnectRef.current = onReconnect;
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
    let everConnected = false;

    const schedule = (delayMs: number) => {
      if (alive) timer = setTimeout(connect, delayMs);
    };

    const connect = () => {
      if (!alive) return;
      // Общая пауза после 429: не бить в /auth/ws-ticket, пока сервер просит подождать.
      if (isPollingPaused()) {
        schedule(pollingResumesInMs() + wsReconnectDelayMs(1));
        return;
      }
      const base = (process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:8100').replace(/^http/, 'ws');
      void (async () => {
        try {
          const qs = await buildWsAuthQuery();
          if (!alive) return;
          const ws = new WebSocket(`${base}/ws/chats/${threadId}${qs}`);
          wsRef.current = ws;
          ws.onopen = () => {
            attempt = 0;
            if (!alive) return;
            setConnected(true);
            if (everConnected) onReconnectRef.current?.();
            everConnected = true;
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
            schedule(nextWsDelayMs(attempt, isPollingPaused() ? pollingResumesInMs() : 0));
          };
        } catch (error) {
          if (alive) setConnected(false);
          // Сессия истекла/нет токена: переподключение не поможет, дальше работает опрос
          // (его 401 обрабатывает общий транспорт) — не долбим /auth/ws-ticket.
          if (classifyWsTicketFailure(error) === 'stop') return;
          attempt += 1;
          schedule(nextWsDelayMs(attempt, isPollingPaused() ? pollingResumesInMs() : 0));
        }
      })();
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
