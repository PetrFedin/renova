/**
 * Запрос с потерянным идентификатором не должен уходить на сервер.
 *
 * Найдено разбором журнала аудита — списка того, что у людей уже ломалось.
 * В нём нашлись такие пути:
 *
 *   POST /api/v1/projects/{id}/issues//close        → 404, трижды
 *   POST /api/v1/projects/{id}/issues//transition   → 404, трижды
 *   POST /api/v1/projects/{id}/purchases//status    → 404, трижды
 *
 * Двойной слэш — это подстановка пустого идентификатора в шаблон адреса:
 * `.../issues/${issueId}/close` при `issueId === ''`. Тип объявляет
 * `id: string`, поэтому проверка типов такого не ловит: пустая строка —
 * законная строка.
 *
 * Такой запрос не может сработать никогда. Сервер отвечает 404, а человек
 * читает «не найдено» про дефект, который у него перед глазами, и не
 * понимает, почему кнопка не работает.
 *
 * Хуже, когда такой запрос попадает в офлайн-очередь: он будет повторяться
 * при каждом восстановлении связи и никогда не пройдёт.
 *
 * Ни один шаблон адреса в `lib/api` не содержит `//` и ни один не
 * оканчивается на `/` — значит оба признака однозначны.
 */

/** Сообщение человеку. Про «не найдено» речи нет: дело не в сервере. */
export const LOST_ID_MESSAGE =
  'Не удалось определить, к чему относится действие. Обновите экран и повторите.';

export class LostIdentifierError extends Error {
  readonly path: string;

  constructor(path: string) {
    super(LOST_ID_MESSAGE);
    this.name = 'LostIdentifierError';
    this.path = path;
  }
}

/** Адрес с потерянным сегментом: `…/issues//close` или `…/issues/`. */
export function hasLostIdentifier(path: string): boolean {
  const pathname = path.split('?')[0] ?? '';
  if (!pathname) return false;
  if (pathname.includes('//')) return true;
  // Хвостовой слэш — тот же потерянный сегмент, только последний.
  return pathname.length > 1 && pathname.endsWith('/');
}

/**
 * Не дать уйти запросу с потерянным идентификатором.
 *
 * Бросаем до отправки: круг до сервера и обратно ничего не добавит, а 404
 * от него только увёл бы разбор в сторону.
 */
export function guardPath(path: string): void {
  if (hasLostIdentifier(path)) throw new LostIdentifierError(path);
}
