/** Шина событий inbox WS — одно подключение, много подписчиков */
type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeInboxWs(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function emitInboxWs(): void {
  listeners.forEach((fn) => {
    try { fn(); } catch { /* noop */ }
  });
}
