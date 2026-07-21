/**
 * Единый async resource: ошибка ≠ пустые данные.
 * Смена contextKey сбрасывает доверие к старым данным.
 */
import { normalizeAppError, type AppError } from './appError';

export type AsyncStatus =
  | 'idle'
  | 'loading'
  | 'refreshing'
  | 'success'
  | 'empty'
  | 'stale'
  | 'offline'
  | 'error';

export type AsyncResource<T> = {
  data: T | null;
  status: AsyncStatus;
  error: AppError | null;
  updatedAt: number | null;
  contextKey: string;
};

export function idleAsyncResource<T>(contextKey = ''): AsyncResource<T> {
  return {
    data: null,
    status: 'idle',
    error: null,
    updatedAt: null,
    contextKey,
  };
}

export type AsyncResourceEvent<T> =
  | { type: 'context'; contextKey: string }
  | { type: 'start'; contextKey: string; soft?: boolean }
  | {
    type: 'success';
    contextKey: string;
    data: T;
    empty?: boolean;
    at?: number;
  }
  | {
    type: 'failure';
    contextKey: string;
    error: unknown;
    offline?: boolean;
    /** Есть локальный cache при offline */
    hasCache?: boolean;
    at?: number;
  };

function isEmptyFlag<T>(data: T, empty?: boolean): boolean {
  if (typeof empty === 'boolean') return empty;
  if (data == null) return true;
  if (Array.isArray(data)) return data.length === 0;
  return false;
}

/**
 * Редьюсер состояний.
 * Refresh error при наличии data → stale (данные сохраняются).
 * First-load error → error (data null).
 * Stale response после смены contextKey игнорируется.
 */
export function reduceAsyncResource<T>(
  state: AsyncResource<T>,
  event: AsyncResourceEvent<T>,
): AsyncResource<T> {
  if (event.type === 'context') {
    if (event.contextKey === state.contextKey) return state;
    return idleAsyncResource<T>(event.contextKey);
  }

  if (event.type === 'start') {
    if (event.contextKey !== state.contextKey) {
      return {
        data: null,
        status: 'loading',
        error: null,
        updatedAt: null,
        contextKey: event.contextKey,
      };
    }
    const soft = Boolean(event.soft) && state.data != null;
    return {
      ...state,
      contextKey: event.contextKey,
      status: soft ? 'refreshing' : 'loading',
      // retry / refresh не очищает data
      error: soft ? state.error : null,
    };
  }

  // success / failure от другого contextKey (project switch) — игнор
  if (event.contextKey !== state.contextKey) {
    return state;
  }

  if (event.type === 'success') {
    const empty = isEmptyFlag(event.data, event.empty);
    return {
      data: event.data,
      status: empty ? 'empty' : 'success',
      error: null,
      updatedAt: event.at ?? Date.now(),
      contextKey: event.contextKey,
    };
  }

  // failure
  const error = normalizeAppError(event.error, { offline: event.offline });
  const at = event.at ?? Date.now();
  const hadData = state.data != null;

  if (event.offline) {
    if (hadData || event.hasCache) {
      return {
        ...state,
        status: 'offline',
        error,
        updatedAt: state.updatedAt ?? at,
      };
    }
    return {
      data: null,
      status: 'offline',
      error,
      updatedAt: null,
      contextKey: event.contextKey,
    };
  }

  if (hadData) {
    // refresh failed — сохранить данные, показать stale
    return {
      ...state,
      status: 'stale',
      error,
    };
  }

  return {
    data: null,
    status: 'error',
    error,
    updatedAt: null,
    contextKey: event.contextKey,
  };
}

export function asyncHasData<T>(r: AsyncResource<T>): boolean {
  return r.data != null;
}

export function asyncShowEmpty<T>(r: AsyncResource<T>): boolean {
  return r.status === 'empty';
}

export function asyncShowError<T>(r: AsyncResource<T>): boolean {
  return r.status === 'error' || (r.status === 'offline' && r.data == null);
}

export function asyncShowStale<T>(r: AsyncResource<T>): boolean {
  return r.status === 'stale' || (r.status === 'offline' && r.data != null);
}

export function asyncIsLoading<T>(r: AsyncResource<T>): boolean {
  return r.status === 'loading' || r.status === 'idle';
}

export function asyncIsRefreshing<T>(r: AsyncResource<T>): boolean {
  return r.status === 'refreshing';
}
