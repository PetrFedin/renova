/**
 * Node-тесты: `@react-native-async-storage/async-storage` на веб-реализации ждёт
 * `window.localStorage`. Подставляем in-memory localStorage и отдаём его же для
 * прямых проверок ключей. Подключать ПЕРВЫМ импортом теста.
 */
const mem = new Map<string, string>();

export const memoryLocalStorage = {
  get length() { return mem.size; },
  key(i: number) { return [...mem.keys()][i] ?? null; },
  getItem(k: string) { return mem.has(k) ? (mem.get(k) as string) : null; },
  setItem(k: string, v: string) { mem.set(k, String(v)); },
  removeItem(k: string) { mem.delete(k); },
  clear() { mem.clear(); },
};

const g = globalThis as Record<string, unknown>;
if (!g.window) g.window = { localStorage: memoryLocalStorage, addEventListener() {}, removeEventListener() {} };
if (!g.localStorage) g.localStorage = memoryLocalStorage;

export function resetMemoryStorage(): void {
  mem.clear();
}
