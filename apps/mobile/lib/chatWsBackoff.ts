/** Переподключение WS чата (COM-025): экспоненциальный backoff с джиттером и честные остановки. */

export const WS_BACKOFF_BASE_MS = 2_000;
export const WS_BACKOFF_MAX_MS = 60_000;

/** Задержка перед попыткой №attempt (1, 2, …): 2 с, 4 с, 8 с … потолок 60 с, ±25% джиттера. */
export function wsReconnectDelayMs(attempt: number, random: () => number = Math.random): number {
  const n = Math.max(1, Math.floor(attempt));
  const exp = Math.min(WS_BACKOFF_MAX_MS, WS_BACKOFF_BASE_MS * 2 ** Math.min(n - 1, 10));
  const jitter = 0.75 + 0.5 * Math.min(1, Math.max(0, random()));
  return Math.min(WS_BACKOFF_MAX_MS, Math.round(exp * jitter));
}

export type WsTicketFailure = 'stop' | 'retry';

/**
 * Что делать после отказа получения билета (`buildWsAuthQuery` бросает
 * `ws_auth_ticket_http_<status>` / `ws_auth_access_token_missing`).
 * 401/403/нет токена — сессия не восстановится переподключением → остановиться;
 * 429, 5xx, сеть — повторить с backoff.
 */
export function classifyWsTicketFailure(error: unknown): WsTicketFailure {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (message === 'ws_auth_access_token_missing') return 'stop';
  const m = /^ws_auth_ticket_http_(\d{3})$/.exec(message);
  if (m) {
    const status = Number(m[1]);
    if (status === 401 || status === 403) return 'stop';
  }
  return 'retry';
}

/** Следующая задержка с учётом общей паузы 429-gate (`pollingResumesInMs`). */
export function nextWsDelayMs(attempt: number, gateResumesInMs: number, random: () => number = Math.random): number {
  return Math.max(wsReconnectDelayMs(attempt, random), Math.max(0, gateResumesInMs));
}
