/**
 * Политика архивных чатов (единая для backend + frontend).
 *
 * 1. Archive — организация списка, не mute и не mark-read.
 * 2. Новое входящее: атомарно снимает archive у получателя → тред в основном списке,
 *    unread входит в global total.
 * 3. muted_until отдельно от is_archived.
 * 4. Архивация не двигает last_read_at / unread_count.
 * 5. Leftover unread в архиве допустим до нового события или ручного read/unarchive;
 *    global badge = сумма unread только по !is_archived.
 */
export const ARCHIVED_CHAT_POLICY = {
  archiveIsListOrg: true,
  archiveIsNotMute: true,
  archiveDoesNotMarkRead: true,
  newMessageUnarchives: true,
  /** Global dock/header badge excludes currently archived threads */
  globalUnreadExcludesArchived: true,
  mutedSeparateFromArchive: true,
} as const;

export type ChatThreadLike = {
  id: string;
  project_id: string;
  unread_count?: number;
  is_archived?: boolean;
  is_muted?: boolean;
  muted_until?: string | null;
  archived_at?: string | null;
};

/** Global unread: только активная папка (после auto-unarchive тред снова здесь). */
export function sumActiveChatUnread(threads: ChatThreadLike[]): number {
  return threads
    .filter((t) => !t.is_archived)
    .reduce((sum, t) => sum + Math.max(0, t.unread_count || 0), 0);
}

/** Unread только в архиве — для пояснения в UI, не для dock. */
export function sumArchivedChatUnread(threads: ChatThreadLike[]): number {
  return threads
    .filter((t) => Boolean(t.is_archived))
    .reduce((sum, t) => sum + Math.max(0, t.unread_count || 0), 0);
}

export function countArchivedWithUnread(threads: ChatThreadLike[]): number {
  return threads.filter((t) => t.is_archived && (t.unread_count || 0) > 0).length;
}

/**
 * Применить событие нового сообщения: снять archive у локального треда
 * (без дубликата — тот же id остаётся одной записью в store).
 */
export function applyIncomingUnarchive<T extends ChatThreadLike>(
  threads: T[],
  threadId: string,
  opts?: { bumpUnreadBy?: number; forUser?: boolean },
): T[] {
  const bump = opts?.bumpUnreadBy ?? 0;
  return threads.map((t) => {
    if (t.id !== threadId) return t;
    return {
      ...t,
      is_archived: false,
      archived_at: null,
      unread_count: Math.max(0, (t.unread_count || 0) + bump),
    };
  });
}

/** Уникальность по thread id — нет дубликатов active+archive. */
export function dedupeThreadsById<T extends { id: string }>(threads: T[]): T[] {
  const map = new Map<string, T>();
  for (const t of threads) map.set(t.id, t);
  return [...map.values()];
}

export function isMuteActive(mutedUntil?: string | null, nowMs = Date.now()): boolean {
  if (!mutedUntil) return false;
  const ts = Date.parse(mutedUntil);
  return Number.isFinite(ts) && ts > nowMs;
}

/** Копирайт: почему в архиве есть unread и что будет дальше. */
export function archiveUnreadExplanation(archivedUnread: number, threadsWithUnread: number): string {
  if (archivedUnread <= 0) {
    return 'Архив — только организация списка. Новое сообщение вернёт чат в «Чаты» и учтёт его в общем счётчике.';
  }
  const chats =
    threadsWithUnread === 1
      ? 'В архиве есть непрочитанные в 1 чате'
      : `В архиве есть непрочитанные в ${threadsWithUnread} чатах`;
  return (
    `${chats} (всего ${archivedUnread}). ` +
    'Они не входят в бейдж «Сообщения», пока чат в архиве. ' +
    'Новое входящее сообщение снимет архив, вернёт чат в список и увеличит общий счётчик. ' +
    'Архивация не отмечает сообщения прочитанными; «без звука» — отдельная настройка.'
  );
}
