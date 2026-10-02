/**
 * O-2 (live-audit-2): Портфель с десятками объектов слал 16–23 запроса budget-breakdown разом
 * (риск 429). Пул ограничивает параллелизм, кэш с TTL не даёт повторять запросы при перевыборе.
 */

/** Результаты в порядке входа; одновременно выполняется не более `limit` задач; `shouldStop` прекращает выдачу новых. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  shouldStop: () => boolean = () => false,
): Promise<(R | undefined)[]> {
  const out: (R | undefined)[] = new Array(items.length).fill(undefined);
  let next = 0;
  const lanes = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  await Promise.all(
    Array.from({ length: lanes }, async () => {
      while (next < items.length && !shouldStop()) {
        const i = next++;
        out[i] = await worker(items[i], i);
      }
    }),
  );
  return out;
}

/** Кэш успешных ответов с TTL и дедупликацией одинаковых запросов «в полёте». Ошибки не кэшируются. */
export function createTtlCache<V>(ttlMs: number, now: () => number = Date.now) {
  const done = new Map<string, { at: number; value: V }>();
  const inflight = new Map<string, Promise<V>>();
  return {
    async get(key: string, load: () => Promise<V>): Promise<V> {
      const hit = done.get(key);
      if (hit && now() - hit.at < ttlMs) return hit.value;
      const pending = inflight.get(key);
      if (pending) return pending;
      const p = load()
        .then((value) => {
          done.set(key, { at: now(), value });
          return value;
        })
        .finally(() => { inflight.delete(key); });
      inflight.set(key, p);
      return p;
    },
    invalidate(prefix?: string) {
      for (const k of [...done.keys()]) if (!prefix || k.startsWith(prefix)) done.delete(k);
    },
    size: () => done.size,
  };
}
