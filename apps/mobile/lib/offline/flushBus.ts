/** W79: после flush offline — слушатели обновляют inbox/home (без циклов import). */
type Listener = () => void;

const listeners = new Set<Listener>();

export function subscribeOfflineFlush(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyOfflineFlush(): void {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* noop */
    }
  });
}
