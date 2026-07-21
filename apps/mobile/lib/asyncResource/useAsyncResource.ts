/**
 * Хук независимого источника данных с защитой от race / unmount / смены project.
 */
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { reportError } from '@/lib/reportError';
import {
  asyncResourceReducer,
  createAsyncResource,
  formatLoadError,
} from './reducer';
import type { AsyncResource } from './types';

export type UseAsyncResourceOptions = {
  /** scope для reportError */
  scope: string;
  projectId: string | null | undefined;
  /** Если false — не грузим (нет user и т.п.) */
  enabled?: boolean;
};

export function useAsyncResource<T>(
  fetcher: () => Promise<T>,
  { scope, projectId, enabled = true }: UseAsyncResourceOptions,
): {
  resource: AsyncResource<T>;
  reload: () => void;
} {
  const [resource, dispatch] = useReducer(
    (s: AsyncResource<T>, a: Parameters<typeof asyncResourceReducer<T>>[1]) =>
      asyncResourceReducer(s, a),
    undefined,
    () => createAsyncResource<T>(projectId ?? null),
  );

  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const runFetch = useCallback(
    (pid: string) => {
      const requestId = ++requestIdRef.current;
      dispatch({ type: 'begin_fetch', projectId: pid, requestId });

      void (async () => {
        try {
          const data = await fetcherRef.current();
          if (!mountedRef.current) return;
          dispatch({ type: 'success', projectId: pid, requestId, data });
        } catch (e: unknown) {
          if (!mountedRef.current) return;
          const message = formatLoadError(e);
          reportError(scope, e, { projectId: pid, requestId });
          dispatch({ type: 'error', projectId: pid, requestId, message });
        }
      })();
    },
    [scope],
  );

  const reload = useCallback(() => {
    const pid = projectId ?? null;
    if (!enabled || !pid) return;
    runFetch(pid);
  }, [enabled, projectId, runFetch]);

  // Смена project / enable: bind + fetch; cleanup отменяет устаревший ответ
  useEffect(() => {
    const pid = projectId ?? null;
    dispatch({ type: 'bind_project', projectId: pid });
    if (!enabled || !pid) return;

    let cancelled = false;
    const requestId = ++requestIdRef.current;
    dispatch({ type: 'begin_fetch', projectId: pid, requestId });

    void (async () => {
      try {
        const data = await fetcherRef.current();
        if (cancelled || !mountedRef.current) return;
        dispatch({ type: 'success', projectId: pid, requestId, data });
      } catch (e: unknown) {
        if (cancelled || !mountedRef.current) return;
        const message = formatLoadError(e);
        reportError(scope, e, { projectId: pid, requestId });
        dispatch({ type: 'error', projectId: pid, requestId, message });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, projectId, scope]);

  return { resource, reload };
}
