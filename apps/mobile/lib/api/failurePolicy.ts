/** Pure failure classification for auth refresh, bootstrap and durable GET cache. */

export type ApiFailureLike = {
  status?: unknown;
  code?: unknown;
};

export function getFailureStatus(error: unknown): number | undefined {
  if (error == null || typeof error !== 'object') return undefined;
  const status = (error as ApiFailureLike).status;
  return typeof status === 'number' ? status : undefined;
}

/**
 * Only an authoritative auth rejection proves that a persisted session is dead.
 * Transport errors, rate limits and 5xx responses must preserve credentials so
 * a temporary outage cannot log the user out.
 */
export function isAuthoritativeRefreshRejection(status: number): boolean {
  return status === 401 || status === 403;
}

export function isAuthoritativeSessionFailure(error: unknown): boolean {
  const status = getFailureStatus(error);
  return status !== undefined && isAuthoritativeRefreshRejection(status);
}

/**
 * A stale durable GET is safer than an empty/error screen only for transient
 * failures. Client/auth errors (4xx except 429) stay authoritative and must not
 * be hidden by old data.
 */
export function shouldFallbackToDurableCache(error: unknown): boolean {
  if (error == null || typeof error !== 'object') return true;

  const failure = error as ApiFailureLike;
  const status = getFailureStatus(error);
  const code = typeof failure.code === 'string' ? failure.code : undefined;

  // Numeric HTTP status is authoritative when present. status=0 is the local
  // transport sentinel used by the client for network/timeout failures.
  if (status === 0) return true;
  if (status === 429) return true;
  if (typeof status === 'number') return status >= 500;

  if (code === 'network' || code === 'timeout' || code === 'rate_limit') return true;

  // Unknown runtime errors keep the previous best-effort cache behaviour.
  return true;
}

/**
 * Можно ли поставить незавершённую запись в офлайн-очередь (#317).
 *
 * `req` нормализует обрыв связи и таймаут в `ApiError(status=0)`. Из-за этого
 * охрана вида `if (e instanceof ApiError) throw e` отбрасывала как раз тот
 * случай, ради которого очередь и существует: обычный офлайн до очереди
 * не доходил вовсе.
 *
 * Граница проходит по тому, знает ли сервер о запросе:
 * - 4xx — сервер ответил отказом. Повторять нечего, и человек должен увидеть
 *   причину. Сюда же 429: это явный отказ со своим сроком, и прятать его
 *   в очередь значило бы скрыть от человека «повторите позже»;
 * - 5xx и `status=0` — исход неизвестен. Запрос мог не дойти, а мог и
 *   выполниться с потерянным ответом; такое место очереди и есть;
 * - не `ApiError` — прежнее поведение: считаем сбоем доставки.
 *
 * Важно: очередь повторяет запрос. Ставить туда операцию можно только если
 * её повтор безопасен — по #316 это значит устойчивый `client_request_id`
 * либо идемпотентность на сервере.
 */
export function isAmbiguousWriteFailure(error: unknown): boolean {
  if (error == null || typeof error !== 'object') return true;
  const status = getFailureStatus(error);
  if (status === undefined) return true;
  if (status >= 400 && status < 500) return false;
  return true;
}
