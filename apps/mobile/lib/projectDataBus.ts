/** W81: смена данных объекта (график, приёмка…) → home/inbox без полного remount. */
type Listener = () => void;

const listeners = new Set<Listener>();

export function subscribeProjectDataChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyProjectDataChanged(): void {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* noop */
    }
  });
}
