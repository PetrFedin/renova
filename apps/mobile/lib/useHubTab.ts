/** Синхронизация вкладок hub-экрана с ?tab= в URL (deep links + persist) */
import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useLocalSearchParams } from 'expo-router';

export function useHubTab<T extends string>(
  allowed: readonly T[],
  defaultTab: T,
  persistKey?: string,
): [T, (tab: T) => void] {
  const { tab: tabParam } = useLocalSearchParams<{ tab?: string }>();
  const [active, setActive] = useState<T>(defaultTab);
  const [hydrated, setHydrated] = useState(!persistKey);

  useEffect(() => {
    if (!persistKey) return;
    let cancelled = false;
    AsyncStorage.getItem(persistKey).then((saved) => {
      if (cancelled) return;
      if (typeof tabParam === 'string' && (allowed as readonly string[]).includes(tabParam)) {
        setActive(tabParam as T);
      } else if (saved && (allowed as readonly string[]).includes(saved)) {
        setActive(saved as T);
        router.setParams({ tab: saved });
      } else {
        setActive(defaultTab);
      }
      setHydrated(true);
    }).catch(() => setHydrated(true));
    return () => { cancelled = true; };
  }, [persistKey, tabParam, allowed, defaultTab]);

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

  const setTab = useCallback((tab: T) => {
    setActive(tab);
    router.setParams({ tab });
    if (persistKey) AsyncStorage.setItem(persistKey, tab).catch(() => {});
  }, [persistKey]);

  return [active, setTab];
}
