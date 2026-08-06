/** Синхронизация вкладок hub-экрана с ?tab= в URL (deep links + persist) */
import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useNavigationContainerRef, useRouter } from 'expo-router';
import { reportCatch, reportError } from '@/lib/reportError';
import {
  HUB_TAB_SYNC_RETRY_DELAYS_MS,
  isHubNavigationReady,
  isRootLayoutMountRace,
} from '@/lib/hubTabNavigation';

export function useHubTab<T extends string>(
  allowed: readonly T[],
  defaultTab: T,
  persistKey?: string,
): [T, (tab: T) => void] {
  const { tab: tabParam } = useLocalSearchParams<{ tab?: string }>();
  const navigationRef = useNavigationContainerRef();
  const router = useRouter();
  const tabParamValid =
    typeof tabParam === 'string'
    && (allowed as readonly string[]).includes(tabParam);
  const [active, setActive] = useState<T>(defaultTab);
  const [hydrated, setHydrated] = useState(!persistKey);
  const mountedRef = useRef(false);
  const pendingTabRef = useRef<T | null>(null);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (syncTimerRef.current != null) clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
      pendingTabRef.current = null;
    };
  }, []);

  const syncTabParam = useCallback((tab: T) => {
    // URL state is derived convenience state. It must never crash the hub while
    // Expo Router is still mounting or replacing its root NavigationContainer.
    pendingTabRef.current = tab;
    if (syncTimerRef.current != null) clearTimeout(syncTimerRef.current);

    let retryIndex = 0;
    const scheduleRetry = (attempt: () => void) => {
      if (!mountedRef.current || retryIndex >= HUB_TAB_SYNC_RETRY_DELAYS_MS.length) return;
      const delay = HUB_TAB_SYNC_RETRY_DELAYS_MS[retryIndex];
      retryIndex += 1;
      syncTimerRef.current = setTimeout(attempt, delay);
    };

    const attemptSync = () => {
      syncTimerRef.current = null;
      if (!mountedRef.current || pendingTabRef.current == null) return;
      if (!isHubNavigationReady(navigationRef)) {
        scheduleRetry(attemptSync);
        return;
      }

      const pendingTab = pendingTabRef.current;
      try {
        router.setParams({ tab: pendingTab });
        if (pendingTabRef.current === pendingTab) pendingTabRef.current = null;
      } catch (error) {
        if (isRootLayoutMountRace(error)) {
          scheduleRetry(attemptSync);
          return;
        }
        // Query synchronization is non-critical, but unexpected router errors
        // remain observable instead of becoming a silent catch.
        reportError('lib.useHubTab.syncTabParam', error);
      }
    };

    attemptSync();
  }, [navigationRef, router]);

  useEffect(() => {
    if (!persistKey) return;
    let cancelled = false;
    AsyncStorage.getItem(persistKey).then((saved) => {
      if (cancelled) return;
      if (tabParamValid) {
        setActive(tabParam as T);
      } else if (saved && (allowed as readonly string[]).includes(saved)) {
        setActive(saved as T);
        // Не дергаем setParams, если tab уже совпадает — иначе цикл навигации.
        if (tabParam !== saved) syncTabParam(saved as T);
      } else {
        setActive(defaultTab);
      }
      setHydrated(true);
    }).catch(() => setHydrated(true));
    return () => { cancelled = true; };
  }, [persistKey, tabParam, tabParamValid, allowed, defaultTab, syncTabParam]);

  useEffect(() => {
    if (persistKey && !hydrated) return;
    if (tabParamValid) {
      setActive(tabParam as T);
      return;
    }
    if (tabParam == null || tabParam === '' || (Array.isArray(tabParam) && !tabParam.length)) {
      if (!persistKey) setActive(defaultTab);
    }
  }, [tabParam, tabParamValid, allowed, defaultTab, persistKey, hydrated]);

  // If a persisted or programmatically selected tab was chosen during router
  // startup, queue it. The retry loop re-checks the real NavigationContainer
  // readiness and cannot bring down the screen while local state stays usable.
  useEffect(() => {
    if (!hydrated || tabParamValid) return;
    if (tabParam !== active) syncTabParam(active);
  }, [hydrated, tabParam, tabParamValid, active, syncTabParam]);

  const setTab = useCallback((tab: T) => {
    setActive(tab);
    syncTabParam(tab);
    if (persistKey) AsyncStorage.setItem(persistKey, tab).catch(reportCatch('lib.useHubTab.1'));
  }, [persistKey, syncTabParam]);

  return [active, setTab];
}
