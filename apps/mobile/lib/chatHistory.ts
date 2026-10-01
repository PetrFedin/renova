/** Окно истории чата (COM-024): последние N сообщений, подгрузка ранних по курсору `before`. */

export const CHAT_PAGE_SIZE = 50;
export const CHAT_MAX_WINDOW = 200;

type Keyed = { id: string; created_at: string };

export function compareMessages(a: Keyed, b: Keyed): number {
  return a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);
}

/** Сколько сообщений запрашивать при обновлении: уже загруженное окно (но не меньше страницы и не больше лимита сервера). */
export function reloadWindowSize(loadedCount: number): number {
  return Math.min(CHAT_MAX_WINDOW, Math.max(CHAT_PAGE_SIZE, Math.floor(loadedCount) || 0));
}

/** Добавляет более ранние сообщения в начало без дублей, сохраняя хронологию. */
export function prependEarlier<T extends Keyed>(current: T[], earlier: T[]): T[] {
  const seen = new Set(current.map((m) => m.id));
  const fresh = earlier.filter((m) => !seen.has(m.id));
  return [...fresh, ...current].sort(compareMessages);
}

/** Есть ли что догружать вверх: серверный флаг, но только пока в окне есть сообщения. */
export function canLoadEarlier(hasMoreBefore: boolean | undefined, messages: Keyed[]): boolean {
  return !!hasMoreBefore && messages.length > 0;
}
