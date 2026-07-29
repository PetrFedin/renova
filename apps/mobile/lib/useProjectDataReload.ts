/** W89: подписка на projectDataBus → локальный reload экрана без remount. */
import { useCallback, useEffect, useRef } from 'react';
import { useFocusEffect } from 'expo-router';

import { subscribeProjectDataChanged } from '@/lib/projectDataBus';
import { isRateLimitError } from '@/lib/api/client';
import { reportError } from '@/lib/reportError';

/** Схлопывает storm notify (accept/sync) — иначе N экранов × 5 GET → 429 */
const RELOAD_DEBOUNCE_MS = 450;

/**
 * Когда другая поверхность сделала golden-path мутацию (syncProjectSideEffects),
 * перечитываем только видимый экран. Скрытый экран помечается stale и выполняет
 * ровно один reload при следующем focus.
 *
 * Promise.reject (в т.ч. rate_limit) всегда ловим — иначе Uncaught Error в Expo.
 */
export function useProjectDataReload(reload: () => void | Promise<void>): void {
  const reloadRef = useRef(reload);
  const focusedRef = useRef(false);
  const staleRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generationRef = useRef(0);
  reloadRef.current = reload;

  const cancelScheduledReload = useCallback((markStale: boolean) => {
    generationRef.current += 1;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      if (markStale) staleRef.current = true;
    }
  }, []);

  const scheduleReload = useCallback((delayMs = RELOAD_DEBOUNCE_MS) => {
    if (!focusedRef.current) {
      staleRef.current = true;
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    const generation = ++generationRef.current;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (generation !== generationRef.current || !focusedRef.current) {
        staleRef.current = true;
        return;
      }
      staleRef.current = false;
      Promise.resolve()
        .then(() => reloadRef.current())
        .catch((error: unknown) => {
          if (isRateLimitError(error)) {
            reportError('projectDataReload.rate_limit', error);
            return;
          }
          reportError('projectDataReload', error);
        });
    }, delayMs);
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeProjectDataChanged(() => {
      if (!focusedRef.current) {
        staleRef.current = true;
        return;
      }
      scheduleReload();
    });

    return () => {
      cancelScheduledReload(false);
      unsubscribe();
    };
  }, [cancelScheduledReload, scheduleReload]);

  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      if (staleRef.current) {
        // Данные уже менялись, пока вкладка была скрыта. Не ждём полный debounce.
        scheduleReload(0);
      }

      return () => {
        focusedRef.current = false;
        cancelScheduledReload(true);
      };
    }, [cancelScheduledReload, scheduleReload]),
  );
}
