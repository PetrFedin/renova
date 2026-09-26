/**
 * Человеческий текст из ответа FastAPI об ошибке проверки полей.
 *
 * FastAPI отдаёт 422 с массивом в `detail`:
 *
 *     {"detail":[{"type":"string_too_long","loc":["body","phone"],
 *                 "msg":"String should have at most 20 characters",
 *                 "ctx":{"max_length":20}}]}
 *
 * `parseApiErrorBody` такой формат не разбирал: массив не строка и не объект с
 * `message`, поэтому срабатывал последний запасной вариант — «показать тело
 * ответа как есть». Пользователь на экране входа получал JSON вместо подсказки.
 * Снято на живом приложении при регистрации по SMS.
 */

type ValidationItem = {
  type?: unknown;
  loc?: unknown;
  msg?: unknown;
  ctx?: Record<string, unknown>;
};

/** Последний осмысленный сегмент `loc`: ["body","phone"] → "phone". */
function fieldName(loc: unknown): string | null {
  if (!Array.isArray(loc)) return null;
  const parts = loc.filter((p): p is string => typeof p === 'string' && p !== 'body' && p !== 'query');
  return parts.length ? parts[parts.length - 1] : null;
}

function ruleText(item: ValidationItem): string {
  const type = typeof item.type === 'string' ? item.type : '';
  const ctx = item.ctx || {};
  const max = ctx.max_length ?? ctx.le ?? ctx.lt;
  const min = ctx.min_length ?? ctx.ge ?? ctx.gt;
  switch (type) {
    case 'missing':
      return 'заполните поле';
    case 'string_too_long':
      return max != null ? `не длиннее ${max} символов` : 'слишком длинное значение';
    case 'string_too_short':
      return min != null ? `не короче ${min} символов` : 'слишком короткое значение';
    case 'string_pattern_mismatch':
    case 'value_error':
      return 'значение в неверном формате';
    case 'int_parsing':
    case 'float_parsing':
    case 'decimal_parsing':
      return 'нужно число';
    case 'bool_parsing':
      return 'нужно «да» или «нет»';
    case 'datetime_parsing':
    case 'date_parsing':
      return 'нужна дата';
    case 'greater_than':
    case 'greater_than_equal':
      return min != null ? `значение должно быть не меньше ${min}` : 'значение слишком маленькое';
    case 'less_than':
    case 'less_than_equal':
      return max != null ? `значение должно быть не больше ${max}` : 'значение слишком большое';
    default:
      return 'значение не принято';
  }
}

/**
 * Собирает подсказку по первым трём полям. `null` — это не ошибка проверки
 * полей, и разбирать её здесь нечем.
 */
export function validationMessage(detail: unknown): string | null {
  if (!Array.isArray(detail) || detail.length === 0) return null;
  const parts: string[] = [];
  for (const raw of detail.slice(0, 3)) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as ValidationItem;
    const field = fieldName(item.loc);
    const rule = ruleText(item);
    parts.push(field ? `«${field}» — ${rule}` : rule);
  }
  if (!parts.length) return null;
  const more = detail.length > parts.length ? ` и ещё ${detail.length - parts.length}` : '';
  return `Сервер не принял данные формы: ${parts.join('; ')}${more}.`;
}

/**
 * Годится ли строка как сообщение пользователю.
 *
 * Тело ответа целиком показывать нельзя: JSON и HTML-страницы ошибок читаются
 * как сбой приложения, а не как подсказка.
 */
export function isHumanMessage(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed.length > 300) return false;
  if (/^[[{<]/.test(trimmed)) return false;
  if (/^(<!doctype|<html)/i.test(trimmed)) return false;
  return true;
}
