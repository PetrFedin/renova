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
  const tabParamValid =
    typeof tabParam === 'string'
    && (allowed as readonly string[]).includes(tabParam);
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

  // If a persisted or programmatically selected tab was set before the root
  // navigator mounted, sync it as soon as navigation becomes available. Never
  // overwrite a valid deep-link tab with the initial local default.
  useEffect(() => {
    if (!navigationReady || !hydrated || tabParamValid) return;
    if (tabParam !== active) syncTabParam(active);
  }, [navigationReady, hydrated, tabParam, tabParamValid, active, syncTabParam]);

  const setTab = useCallback((tab: T) => {
    setActive(tab);
    syncTabParam(tab);
    if (persistKey) AsyncStorage.setItem(persistKey, tab).catch(reportCatch('lib.useHubTab.1'));
  }, [persistKey, syncTabParam]);

  return [active, setTab];
}
