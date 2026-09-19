/**
 * Что показывать в шапке переписки над закреплёнными сообщениями.
 *
 * Сервер отдаёт закреплённые отдельным списком, свежие первыми. Экран
 * показывает их компактной строкой: сообщение при этом остаётся на своём
 * месте в истории, а по нажатию история прокручивается к нему.
 *
 * Здесь только расчёт текста и порядка — без React и без сети.
 */

export type PinnedSource = {
  id: string;
  text?: string | null;
  message_type?: string;
  file_name?: string | null;
  is_pinned?: boolean;
};

export type PinnedEntry = {
  id: string;
  /** Одна строка для шапки. */
  preview: string;
};

const TYPE_FALLBACK: Record<string, string> = {
  photo: 'Фото',
  file: 'Файл',
  payment: 'Счёт',
  task: 'Задача',
  confirm: 'Подтверждение',
  system: 'Системное сообщение',
};

const PREVIEW_LIMIT = 80;

/** Одна строка вместо сообщения: без переносов и не длиннее строки шапки. */
export function pinnedPreview(message: PinnedSource): string {
  const text = (message.text || '').replace(/\s+/g, ' ').trim();
  if (text) {
    return text.length > PREVIEW_LIMIT ? `${text.slice(0, PREVIEW_LIMIT - 1)}…` : text;
  }
  if (message.file_name) return message.file_name;
  return TYPE_FALLBACK[message.message_type || ''] || 'Сообщение';
}

/**
 * Список для шапки.
 *
 * Если сервер ещё не отдаёт `pinned_messages` (постепенный выкат), берём
 * закреплённые из самой истории — иначе шапка была бы пустой там, где
 * закрепления есть.
 */
export function pinnedEntries(
  pinned: PinnedSource[] | undefined,
  messages: PinnedSource[],
): PinnedEntry[] {
  const source = pinned && pinned.length
    ? pinned
    : [...messages].filter((m) => m.is_pinned).reverse();
  const seen = new Set<string>();
  const entries: PinnedEntry[] = [];
  for (const message of source) {
    if (seen.has(message.id)) continue;
    seen.add(message.id);
    entries.push({ id: message.id, preview: pinnedPreview(message) });
  }
  return entries;
}

/** Подпись счётчика в шапке: «Закреплено» или «Закреплено · 3». */
export function pinnedLabel(count: number): string {
  return count > 1 ? `Закреплено · ${count}` : 'Закреплено';
}
