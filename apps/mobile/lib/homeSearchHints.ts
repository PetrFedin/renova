/** Контекстные подсказки поиска с главной — синхронизация шапки и контента */
const listeners = new Set<() => void>();
let hints: string[] = [];

export function setHomeSearchHints(next: string[]): void {
  hints = [...new Set(next.filter(Boolean))].slice(0, 5);
  listeners.forEach((fn) => fn());
}

export function clearHomeSearchHints(): void {
  hints = [];
  listeners.forEach((fn) => fn());
}

export function getHomeSearchHints(): string[] {
  return hints;
}

export function subscribeHomeSearchHints(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}
