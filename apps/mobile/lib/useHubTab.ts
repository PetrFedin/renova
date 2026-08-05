/** Синхронизация вкладок hub-экрана с ?tab= в URL (deep links + persist) */
import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useLocalSearchParams, useRootNavigationState } from 'expo-router';
import { reportCatch } from '@/lib/reportError';

export function useHubTab<T extends string>(
  allowed: readonly T[],
  defaultTab: T,
  persistKey?: string,
): [T, (tab: T) => void] {
  const { tab: tabParam } = useLocalSearchParams<{ tab?: string }>();
  const rootNavigationState = useRootNavigationState();
  const navigationReady = Boolean(rootNavigationState?.key);
  const [active, setActive] = useState<T>(defaultTab);
  const [hydrated, setHydrated] = useState(!persistKey);

  const syncTabParam = useCallback((tab: T) => {
    // Expo Router throws if setParams runs during the first render before the
    // root Slot/navigator has mounted. Local state remains authoritative until
    // navigation becomes ready; the hydration effect below then synchronizes
    // the URL without crashing the entire hub screen.
    if (!navigationReady) return;
    router.setParams({ tab });
  }, [navigationReady]);

  useEffect(() => {
    if (!persistKey) return;
    let cancelled = false;
    AsyncStorage.getItem(persistKey).then((saved) => {
      if (cancelled) return;
      if (typeof tabParam === 'string' && (allowed as readonly string[]).includes(tabParam)) {
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
  }, [persistKey, tabParam, allowed, defaultTab, syncTabParam]);

  useEffect(() => {
    if (persistKey && !hydrated) return;
    if (typeof tabParam === 'string' && (allowed as readonly string[]).includes(tabParam)) {
      setActive(tabParam as T);
      return;
    }
    if (tabParam == null || tabParam === '' || (Array.isArray(tabParam) && !tabParam.length)) {
      if (!persistKey) setActive(defaultTab);
    }
  }, [tabParam, allowed, defaultTab, persistKey, hydrated]);

  // If a persisted tab was restored before the root navigator mounted, sync it
  // as soon as navigation becomes available. This keeps deep links truthful
  // without making initial rendering depend on router readiness.
  useEffect(() => {
    if (!navigationReady || !hydrated) return;
    if (tabParam !== active) syncTabParam(active);
  }, [navigationReady, hydrated, tabParam, active, syncTabParam]);

  const setTab = useCallback((tab: T) => {
    setActive(tab);
    syncTabParam(tab);
    if (persistKey) AsyncStorage.setItem(persistKey, tab).catch(reportCatch('lib.useHubTab.1'));
  }, [persistKey, syncTabParam]);

  return [active, setTab];
}
