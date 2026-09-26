/**
 * Почему не загрузилось — своими словами.
 *
 * Единственная подсказка «Проверьте сеть и повторите» врёт на 429: сеть в
 * порядке, сервер просит подождать, а немедленный повтор только продлевает
 * ограничение. Приложение уже умеет отличать 429 (`isRateLimitError`) и
 * честно говорит об этом на входе — экраны загрузки просто не пользовались
 * этим знанием.
 */
export type LoadErrorKind = 'rate_limit' | 'server' | 'offline' | 'unknown';

const RATE_LIMIT_HINT =
  'Сервер просит подождать: слишком много запросов. Повторите через несколько секунд.';
const SERVER_HINT =
  'Сбой на стороне сервера. Это не пустой список — повторите чуть позже.';
const OFFLINE_HINT = 'Проверьте сеть и повторите. Это не пустой список.';

export function loadErrorKind(error: unknown): LoadErrorKind {
  if (error == null || typeof error !== 'object') return 'unknown';
  const err = error as { status?: unknown; code?: unknown; message?: unknown };
  const status = typeof err.status === 'number' ? err.status : null;
  if (status === 429 || err.code === 'rate_limit') return 'rate_limit';
  if (typeof err.message === 'string' && err.message.toLowerCase().includes('слишком много запросов')) {
    return 'rate_limit';
  }
  if (status !== null && status >= 500) return 'server';
  // status 0 — запрос не дошёл: обрыв связи, а не ответ сервера.
  if (status === 0 || err.code === 'network' || err.code === 'timeout') return 'offline';
  return 'unknown';
}

export function loadErrorHint(error: unknown, fallback = OFFLINE_HINT): string {
  switch (loadErrorKind(error)) {
    case 'rate_limit': return RATE_LIMIT_HINT;
    case 'server': return SERVER_HINT;
    case 'offline': return OFFLINE_HINT;
    default: return fallback;
  }
}

/** Повтор сразу же осмыслен не всегда: при 429 он продлевает ограничение. */
export function retryIsImmediate(error: unknown): boolean {
  return loadErrorKind(error) !== 'rate_limit';
}
