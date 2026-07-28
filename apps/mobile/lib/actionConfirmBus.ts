/**
 * Clarity E/M: глобальный post-action sheet без Alert.
 * Вызов из lib/* и экранов → UI в ActionConfirmHost.
 */
export type ActionConfirmAction = {
  label: string;
  onPress: () => void;
  destructive?: boolean;
};

export type ActionConfirmPayload = {
  title: string;
  message: string;
  /** Legacy 1–2 кнопки (waves E–L) */
  primaryLabel?: string;
  onPrimary?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  /** Clarity M: multi-option меню */
  actions?: ActionConfirmAction[];
  /** Clarity P: backdrop/«Закрыть» без кнопки → cancel (для Promise-confirm) */
  onDismiss?: () => void;
};

type Listener = (payload: ActionConfirmPayload | null) => void;

let current: ActionConfirmPayload | null = null;
const listeners = new Set<Listener>();

export function showActionConfirm(payload: ActionConfirmPayload): void {
  current = payload;
  listeners.forEach((fn) => fn(payload));
}

export function clearActionConfirm(): void {
  current = null;
  listeners.forEach((fn) => fn(null));
}

export function subscribeActionConfirm(fn: Listener): () => void {
  listeners.add(fn);
  if (current) fn(current);
  return () => {
    listeners.delete(fn);
  };
}
