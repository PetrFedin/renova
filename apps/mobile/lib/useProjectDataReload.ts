/** W89: подписка на projectDataBus → локальный reload экрана без remount. */
import { useEffect, useRef } from 'react';
import { subscribeProjectDataChanged } from '@/lib/projectDataBus';
import { isRateLimitError } from '@/lib/api/client';
import { reportError } from '@/lib/reportError';

/** Схлопывает storm notify (accept/sync) — иначе N экранов × 5 GET → 429 */
const RELOAD_DEBOUNCE_MS = 450;

/**
 * Когда другая поверхность сделала golden-path мутацию (syncProjectSideEffects),
 * экран с локальным state (приёмка, контроль) перечитывает данные.
 *
 * Важно: Promise.reject (в т.ч. rate_limit) всегда ловим — иначе Uncaught Error в Expo.
 */
export function useProjectDataReload(reload: () => void | Promise<void>): void {
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let generation = 0;

    const unsub = subscribeProjectDataChanged(() => {
      if (timer) clearTimeout(timer);
      const gen = ++generation;
      timer = setTimeout(() => {
        if (gen !== generation) return;
        Promise.resolve()
          .then(() => reloadRef.current())
          .catch((e: unknown) => {
            // 429 — ожидаемо при storm; не роняем UI
            if (isRateLimitError(e)) {
              reportError('projectDataReload.rate_limit', e);
              return;
            }
            reportError('projectDataReload', e);
          });
      }, RELOAD_DEBOUNCE_MS);
    });

    return () => {
      generation += 1;
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, []);
}
