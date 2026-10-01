/** Поиск по чатам (COM-037): разбор ответа сервера и переход к найденному сообщению. */

export type ChatSearchHit = {
  id: string;
  thread_id: string;
  thread_title?: string | null;
  author_role?: string | null;
  text: string;
  created_at?: string | null;
};

/** Отбрасывает записи старого формата (без id сообщения) и мусор. */
export function parseChatSearchHits(raw: unknown): ChatSearchHit[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatSearchHit[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (typeof r.id !== 'string' || !r.id || typeof r.thread_id !== 'string' || !r.thread_id) continue;
    out.push({
      id: r.id,
      thread_id: r.thread_id,
      thread_title: typeof r.thread_title === 'string' ? r.thread_title : null,
      author_role: typeof r.author_role === 'string' ? r.author_role : null,
      text: typeof r.text === 'string' ? r.text : '',
      created_at: typeof r.created_at === 'string' ? r.created_at : null,
    });
  }
  return out;
}

/** Поиск в открытом треде: только его сообщения, без дублей по id. */
export function hitsForThread(hits: ChatSearchHit[], threadId: string): ChatSearchHit[] {
  const seen = new Set<string>();
  return hits.filter((h) => {
    if (h.thread_id !== threadId || seen.has(h.id)) return false;
    seen.add(h.id);
    return true;
  });
}

/** Попадание в уже загруженное окно → просто прокрутить; иначе → подгрузить окно `around`. */
export function jumpPlan(messageIds: string[], targetId: string): 'scroll' | 'load_around' {
  return messageIds.includes(targetId) ? 'scroll' : 'load_around';
}
