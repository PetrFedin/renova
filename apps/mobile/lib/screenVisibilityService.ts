/**
 * Синхронный SoT foreground для mark-read.
 * Обновляется сразу на AppState / document.visibility — до React re-render,
 * чтобы WS в background не успел вызвать mark-read по устаревшему state.
 */
import { AppState, Platform, type AppStateStatus } from 'react-native';
import { isForegroundLifecycle } from '@/lib/domain/screenVisibility';

type Listener = () => void;

let appState: AppStateStatus = AppState.currentState;
let webDocumentVisible: boolean | null = null;
let started = false;
const listeners = new Set<Listener>();

/** Вызывается store при потере foreground — без ожидания React */
type ForegroundHook = (foreground: boolean) => void;
let foregroundHooks = new Set<ForegroundHook>();

function readWebDocumentVisible(): boolean | null {
  if (Platform.OS !== 'web') return null;
  try {
    if (typeof document === 'undefined') return null;
    return document.visibilityState === 'visible';
  } catch {
    return null;
  }
}

function computeForeground(): boolean {
  return isForegroundLifecycle(appState, {
    webDocumentVisible: webDocumentVisible ?? readWebDocumentVisible(),
  });
}

let cachedForeground = computeForeground();

function publish() {
  const next = computeForeground();
  const changed = next !== cachedForeground;
  cachedForeground = next;
  if (changed) {
    for (const hook of foregroundHooks) {
      try {
        hook(next);
      } catch {
        /* ignore hook errors */
      }
    }
  }
  for (const l of listeners) {
    try {
      l();
    } catch {
      /* ignore */
    }
  }
}

function onAppStateChange(next: AppStateStatus) {
  appState = next;
  // Background/inactive: немедленно visible=false до любого WS microtask
  publish();
}

function onDocumentVisibility() {
  webDocumentVisible = readWebDocumentVisible();
  publish();
}

/** Подписка AppState (+ web visibility). Идемпотентно. */
export function ensureScreenVisibilityListening(): void {
  if (started) return;
  started = true;
  appState = AppState.currentState;
  webDocumentVisible = readWebDocumentVisible();
  cachedForeground = computeForeground();
  AppState.addEventListener('change', onAppStateChange);
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onDocumentVisibility);
  }
}

export function getAppForeground(): boolean {
  ensureScreenVisibilityListening();
  return cachedForeground;
}

export function getAppLifecycleState(): AppStateStatus {
  ensureScreenVisibilityListening();
  return appState;
}

export function subscribeAppForeground(listener: Listener): () => void {
  ensureScreenVisibilityListening();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Store: сразу сбросить activeThreadContext.appForeground */
export function onAppForegroundChange(hook: ForegroundHook): () => void {
  ensureScreenVisibilityListening();
  foregroundHooks.add(hook);
  return () => {
    foregroundHooks.delete(hook);
  };
}

/** Тесты: симуляция background / foreground без RN */
export function __testSetLifecycle(
  state: AppStateStatus,
  opts?: { webDocumentVisible?: boolean | null },
): void {
  appState = state;
  if (opts && 'webDocumentVisible' in opts) {
    webDocumentVisible = opts.webDocumentVisible ?? null;
  }
  publish();
}

export function __testResetScreenVisibility(): void {
  appState = 'active';
  webDocumentVisible = null;
  cachedForeground = true;
  listeners.clear();
  foregroundHooks.clear();
  started = false;
}
