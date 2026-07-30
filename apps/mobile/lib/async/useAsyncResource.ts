import { useCallback, useEffect, useRef, useState } from 'react';
import { reportError } from '@/lib/reportError';
import {
  idleAsyncResource,
  reduceAsyncResource,
  type AsyncLoadResult,
  type AsyncResource,
} from './asyncResource';

export type UseAsyncResourceOptions<T> = {
  contextKey: string;
  enabled?: boolean;
  fetcher: (signal: AbortSignal) => Promise<AsyncLoadResult<T>>;
  isEmpty?: (data: T) => boolean;
  scope?: string;
  autoLoad?: boolean;
};

export type UseAsyncResourceResult<T> = {
  resource: AsyncResource<T>;
  data: T | null;
  reload: (options?: { soft?: boolean }) => Promise<void>;
  setData: (data: T) => void;
};

export function useAsyncResource<T>(
  options: UseAsyncResourceOptions<T>,
): UseAsyncResourceResult<T> {
  const {
    contextKey,
    enabled = true,
    fetcher,
    isEmpty,
    scope = 'asyncResource',
    autoLoad = true,
  } = options;
  const [resource, setResource] = useState<AsyncResource<T>>(() =>
    idleAsyncResource<T>(contextKey),
  );
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const isEmptyRef = useRef(isEmpty);
  isEmptyRef.current = isEmpty;
  const generationRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    generationRef.current += 1;
    abortRef.current?.abort();
    setResource((previous) =>
      reduceAsyncResource(previous, { type: 'context', contextKey }),
    );
    return () => abortRef.current?.abort();
  }, [contextKey]);

  const reload = useCallback(async (reloadOptions?: { soft?: boolean }) => {
    if (!enabled) return;
    const key = contextKey;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const generation = ++generationRef.current;

    setResource((previous) =>
      reduceAsyncResource(previous, {
        type: 'start',
        contextKey: key,
        soft: reloadOptions?.soft ?? previous.data != null,
      }),
    );

    try {
      const result = await fetcherRef.current(controller.signal);
      if (generation !== generationRef.current || controller.signal.aborted) return;
      setResource((previous) =>
        reduceAsyncResource(previous, {
          type: 'success',
          contextKey: key,
          data: result.data,
          empty: isEmptyRef.current?.(result.data),
          stale: result.stale,
          at: result.updatedAt,
        }),
      );
    } catch (error) {
      if (generation !== generationRef.current || controller.signal.aborted) return;
      reportError(scope, error, { contextKey: key });
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      setResource((previous) =>
        reduceAsyncResource(previous, {
          type: 'failure',
          contextKey: key,
          error,
          offline,
        }),
      );
    }
  }, [contextKey, enabled, scope]);

  useEffect(() => {
    if (!autoLoad || !enabled) return;
    void reload({ soft: false });
  }, [autoLoad, enabled, contextKey, reload]);

  const setData = useCallback((data: T) => {
    setResource((previous) =>
      reduceAsyncResource(previous, {
        type: 'success',
        contextKey: previous.contextKey,
        data,
        empty: isEmptyRef.current?.(data),
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
