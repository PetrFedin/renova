/** INB-18: человеческий текст при ошибке открытия ссылки на портал (гость не должен видеть коды). */
export const PORTAL_LINK_INVALID_MESSAGE =
  'Ссылка недействительна или срок её действия истёк. Попросите прислать новую ссылку.';

type ErrorLike = { status?: unknown; code?: unknown; message?: unknown; name?: unknown };

const SNAKE_CODE = /^[a-z][a-z0-9_]*$/;

export function portalLoadErrorMessage(error: unknown): string {
  const e = (error && typeof error === 'object' ? error : {}) as ErrorLike;
  const message = typeof e.message === 'string' ? e.message.trim() : '';
  const code = typeof e.code === 'string' ? e.code : '';
  if (e.status === 401 || e.status === 403 || code === 'invalid_portal_token' || message === 'invalid_portal_token') {
    return PORTAL_LINK_INVALID_MESSAGE;
  }
  if (e.status === 404 || code === 'not_found') {
    return 'Объект по этой ссылке не найден. Возможно, его удалили — уточните у исполнителя.';
  }
  if (e.status === 429) return 'Слишком много запросов. Подождите несколько секунд и откройте ссылку снова.';
  if (e.status === 0 || e.name === 'TypeError' || /failed to fetch|network request failed/i.test(message)) {
    return 'Нет связи с сервером. Проверьте интернет и откройте ссылку снова.';
  }
  if (message && !SNAKE_CODE.test(message) && !message.startsWith('{')) return message;
  return 'Не удалось открыть портал. Повторите попытку позже или попросите новую ссылку.';
}
