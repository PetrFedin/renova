/**
 * Чистая (без react-native) часть кроссплатформенных уведомлений: человеческая причина ошибки.
 * ApiError.message уже разобран в parseApiErrorBody (client.ts) — здесь только страхуем
 * технические коды (offline_queued, rate_limit, …), JSON-тела и сетевые сбои.
 */
import { OFFLINE_MESSAGES } from '@/lib/offlineErrors';
import { normalizeAppError } from '@/lib/async/appError';

const CODE_MESSAGES: Record<string, string> = {
  ...OFFLINE_MESSAGES,
  rate_limit: 'Слишком много запросов. Подождите несколько секунд и повторите.',
  unauthorized: 'Сессия истекла. Войдите снова.',
  forbidden: 'Недостаточно прав для этого действия.',
  not_found: 'Данные не найдены или были удалены.',
  validation_error: 'Проверьте заполненные поля и повторите.',
  completion_gate: 'Не выполнены условия для этого действия.',
};

const SNAKE_CODE = /^[a-z][a-z0-9_]*$/;

/**
 * Причина ошибки для пользователя: что не так и что делать; null — причину определить нельзя.
 */
export function failureReason(error: unknown): string | null {
  if (typeof error === 'string') {
    const s = error.trim();
    if (!s) return null;
    return CODE_MESSAGES[s] ?? (SNAKE_CODE.test(s) ? null : s);
  }
  if (error && typeof error === 'object') {
    const e = error as { message?: unknown; code?: unknown; status?: unknown; name?: unknown };
    const msg = typeof e.message === 'string' ? e.message.trim() : '';
    if (msg && CODE_MESSAGES[msg]) return CODE_MESSAGES[msg];
    if (e.status === 429) return CODE_MESSAGES.rate_limit;
    if (typeof e.code === 'string' && CODE_MESSAGES[e.code] && (!msg || SNAKE_CODE.test(msg))) {
      return CODE_MESSAGES[e.code];
    }
    const looksTechnical = !msg || SNAKE_CODE.test(msg) || msg.startsWith('{') || msg.startsWith('[');
    const isNetwork = e.name === 'TypeError' || /failed to fetch|network request failed|networkerror/i.test(msg);
    if (isNetwork || (looksTechnical && (typeof e.status === 'number' || e.name === 'AbortError'))) {
      const norm = normalizeAppError(error);
      if (norm.kind !== 'unknown') return norm.message;
    }
    if (!looksTechnical) return msg;
  }
  return null;
}

/**
 * Текст для пользователя: «что не удалось» + причина. Без причины остаётся `what`
 * (или общий совет), а не пустое «Не удалось …».
 */
export function describeFailure(error: unknown, what?: string): string {
  const reason = failureReason(error);
  const base = what?.trim();
  if (!reason) return base || 'Повторите попытку позже.';
  if (!base || /^Не удалось\s*$/.test(base)) return reason;
  if (reason === CODE_MESSAGES.offline_queued) return reason;
  if (!/^Не удалось/i.test(base)) return reason;
  const head = base.replace(/[.\s]+$/, '');
  if (reason.toLowerCase().startsWith(head.toLowerCase())) return reason;
  return `${head}. ${reason}`;
}
