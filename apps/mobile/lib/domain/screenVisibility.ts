/**
 * Единая политика «экран реально виден» для mark-read / unread suppress.
 * Чистая логика без I/O — RN AppState и document.visibility подключаются снаружи.
 */

export type AppLifecycleState = 'active' | 'background' | 'inactive' | 'unknown' | string;

/**
 * Foreground для read receipt: только `active`.
 * iOS inactive (lock / Control Center) ≠ просмотр — mark-read запрещён.
 * Web: document.visibilityState === 'hidden' перекрывает AppState.
 */
export function isForegroundLifecycle(
  appState: AppLifecycleState,
  opts?: { webDocumentVisible?: boolean | null },
): boolean {
  if (opts?.webDocumentVisible === false) return false;
  return appState === 'active';
}

export type ScreenVisibilityInput = {
  /** Синхронный foreground (AppState + web visibility) */
  appForeground: boolean;
  /** React Navigation / Expo Router focus */
  screenFocused: boolean;
  /** activeThreadId === incoming / route threadId */
  threadIdMatches: boolean;
  /** Пользователь залогинен (logout → false) */
  loggedIn: boolean;
  /** Modal/invite/settings полностью перекрывают ленту */
  overlayBlocking: boolean;
  /** threadLoaded && access && messages painted */
  threadContentReady: boolean;
  /** Компонент ещё смонтирован */
  mounted: boolean;
};

/** Экран виден пользователю — можно suppress unread / слать read receipt */
export function evaluateScreenVisible(input: ScreenVisibilityInput): boolean {
  if (!input.mounted || !input.loggedIn) return false;
  if (!input.appForeground || !input.screenFocused) return false;
  if (!input.threadIdMatches) return false;
  if (input.overlayBlocking) return false;
  if (!input.threadContentReady) return false;
  return true;
}

/**
 * Mark-read разрешён только при:
 * appForeground && screenFocused && threadIdMatches && threadContentReady
 * (+ loggedIn, mounted, без overlay).
 */
export function evaluateMarkReadAllowed(input: ScreenVisibilityInput): boolean {
  return evaluateScreenVisible(input);
}

/** Push delivery ≠ read: получение push никогда не открывает gate */
export function pushReceiptImpliesRead(): false {
  return false;
}

/** Открытие push только навигирует; mark-read — после load + visible */
export type PushOpenReadPolicy = {
  navigatesToThread: true;
  marksReadOnReceive: false;
  marksReadOnOpen: false;
  marksReadAfterVisibleLoad: true;
};

export const PUSH_OPEN_READ_POLICY: PushOpenReadPolicy = {
  navigatesToThread: true,
  marksReadOnReceive: false,
  marksReadOnOpen: false,
  marksReadAfterVisibleLoad: true,
};
