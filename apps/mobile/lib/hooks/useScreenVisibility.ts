/**
 * Единый visibility hook для чата и других экранов с read-receipt семантикой.
 * Учитывает: Navigation focus, AppState, web document.visibility,
 * overlay/modal, logout, unmount, active thread id, готовность контента.
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';
import {
  evaluateMarkReadAllowed,
  evaluateScreenVisible,
  type ScreenVisibilityInput,
} from '@/lib/domain/screenVisibility';
import {
  ensureScreenVisibilityListening,
  getAppForeground,
  subscribeAppForeground,
} from '@/lib/screenVisibilityService';

export type UseScreenVisibilityArgs = {
  screenFocused: boolean;
  /** ID треда на маршруте / ожидаемый incoming */
  routeThreadId: string | null | undefined;
  /** Опубликованный active thread (обычно = route при открытом экране) */
  activeThreadId?: string | null;
  threadContentReady: boolean;
  overlayBlocking?: boolean;
  loggedIn: boolean;
};

export type ScreenVisibilityState = {
  appForeground: boolean;
  screenVisible: boolean;
  /** Синоним screenVisible для mark-read gate */
  canMarkRead: boolean;
  input: ScreenVisibilityInput;
};

export function useScreenVisibility(args: UseScreenVisibilityArgs): ScreenVisibilityState {
  ensureScreenVisibilityListening();
  const appForeground = useSyncExternalStore(
    subscribeAppForeground,
    getAppForeground,
    getAppForeground,
  );

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const routeThreadId = args.routeThreadId ?? null;
  const activeThreadId = args.activeThreadId !== undefined
    ? args.activeThreadId
    : routeThreadId;
  const threadIdMatches = Boolean(
    routeThreadId
    && activeThreadId
    && routeThreadId === activeThreadId,
  );

  const input: ScreenVisibilityInput = {
    appForeground,
    screenFocused: args.screenFocused,
    threadIdMatches,
    loggedIn: args.loggedIn,
    overlayBlocking: Boolean(args.overlayBlocking),
    threadContentReady: args.threadContentReady,
    mounted: mountedRef.current,
  };

  const screenVisible = evaluateScreenVisible(input);
  const canMarkRead = evaluateMarkReadAllowed(input);

  return { appForeground, screenVisible, canMarkRead, input };
}
