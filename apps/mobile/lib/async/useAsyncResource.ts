/**
 * Хук загрузки с AsyncResource: contextKey, soft refresh, stale, offline.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  idleAsyncResource,
  reduceAsyncResource,
  type AsyncResource,
} from './asyncResource';
import { reportError } from '@/lib/reportError';

export type UseAsyncResourceOptions<T> = {
  contextKey: string;
  /** false — не грузить (нет user/project) */
  enabled?: boolean;
  fetcher: () => Promise<T>;
  /** Явный empty (иначе: null / []) */
  isEmpty?: (data: T) => boolean;
  /** Имя для reportError */
  scope?: string;
  /** Автозагрузка при смене contextKey */
  autoLoad?: boolean;
};

export type UseAsyncResourceResult<T> = {
  resource: AsyncResource<T>;
  data: T | null;
  reload: (opts?: { soft?: boolean }) => Promise<void>;
  setData: (data: T) => void;
};

export function useAsyncResource<T>(
  opts: UseAsyncResourceOptions<T>,
): UseAsyncResourceResult<T> {
  const {
    contextKey,
    enabled = true,
    fetcher,
    isEmpty,
    scope = 'asyncResource',
    autoLoad = true,
  } = opts;

  const [resource, setResource] = useState<AsyncResource<T>>(() =>
    idleAsyncResource<T>(contextKey),
  );
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const isEmptyRef = useRef(isEmpty);
  isEmptyRef.current = isEmpty;
  const genRef = useRef(0);

  // Смена проекта / ключа — не считать старые данные новыми
  useEffect(() => {
    setResource((prev) => reduceAsyncResource(prev, { type: 'context', contextKey }));
  }, [contextKey]);

  const reload = useCallback(async (reloadOpts?: { soft?: boolean }) => {
    if (!enabled) return;
    const key = contextKey;
    const gen = ++genRef.current;
    setResource((prev) =>
      reduceAsyncResource(prev, {
        type: 'start',
        contextKey: key,
        soft: reloadOpts?.soft ?? prev.data != null,
      }),
    );
    try {
      const data = await fetcherRef.current();
      if (gen !== genRef.current) return; // stale response after switch
      const empty = isEmptyRef.current ? isEmptyRef.current(data) : undefined;
      setResource((prev) =>
        reduceAsyncResource(prev, {
          type: 'success',
          contextKey: key,
          data,
          empty,
        }),
      );
    } catch (e) {
      if (gen !== genRef.current) return;
      reportError(scope, e, { contextKey: key });
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      setResource((prev) =>
        reduceAsyncResource(prev, {
          type: 'failure',
          contextKey: key,
          error: e,
          offline,
          hasCache: prev.data != null,
        }),
      );
    }
  }, [contextKey, enabled, scope]);

  useEffect(() => {
    if (!autoLoad || !enabled) return;
    void reload({ soft: false });
  }, [autoLoad, enabled, contextKey, reload]);

  const setData = useCallback((data: T) => {
    setResource((prev) =>
      reduceAsyncResource(prev, {
        type: 'success',
        contextKey: prev.contextKey,
        data,
        empty: isEmptyRef.current ? isEmptyRef.current(data) : undefined,
      }),
    );
  }, []);

  return {
    resource,
    data: resource.data,
    reload,
    setData,
  };
}
