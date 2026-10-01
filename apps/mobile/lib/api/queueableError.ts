/**
 * Единый предикат «запись можно поставить в офлайн-очередь» (CMP-001).
 *
 * `req` превращает обрыв сети и таймаут в `ApiError(status=0)`, поэтому охрана
 * `if (e instanceof ApiError) throw e` делала ветку очереди недостижимой.
 *
 * В очередь идут:
 * - `ApiError(0)` — обрыв/таймаут, исход неизвестен;
 * - 5xx — сервер мог выполнить запрос и потерять ответ;
 * - 429 — отказ с «повторите позже», повтор безопасен;
 * - любая не-`ApiError` ошибка доставки (прежнее поведение).
 *
 * Детерминированные 4xx (400/401/403/404/409/422 …) авторитетны: сервер
 * ответил отказом, повторять нечего, пользователь должен увидеть причину.
 *
 * Очередь повторяет запрос: ставить в неё можно только операции, повтор
 * которых безопасен (стабильный `client_request_id` или идемпотентность
 * на сервере).
 */
export function isQueueableWriteError(error: unknown): boolean {
  if (error == null || typeof error !== 'object') return true;
  const status = (error as { status?: unknown }).status;
  if (typeof status !== 'number') return true;
  if (status === 429) return true;
  if (status >= 400 && status < 500) return false;
  return true;
}

/**
 * CMP-028: вся очередь лежит одним JSON-массивом в AsyncStorage; на Android
 * строка свыше ≈2 МБ срывает запись всей очереди. Крупные тела (фото base64,
 * .ics) в очередь не ставим — честно сообщаем «нужна сеть».
 */
export const MAX_QUEUED_BODY_CHARS = 1_500_000;

export function exceedsQueueBodyLimit(body: string | null | undefined): boolean {
  return (body?.length ?? 0) > MAX_QUEUED_BODY_CHARS;
}
