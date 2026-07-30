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

export type AsyncLoadResult<T> = {
  data: T;
  stale?: boolean;
  updatedAt?: number;
};

export type AsyncResourceEvent<T> =
  | { type: 'context'; contextKey: string }
  | { type: 'start'; contextKey: string; soft?: boolean }
  | {
      type: 'success';
      contextKey: string;
      data: T;
      empty?: boolean;
      stale?: boolean;
      at?: number;
    }
  | {
      type: 'failure';
      contextKey: string;
      error: unknown;
      offline?: boolean;
      at?: number;
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

function isEmptyValue<T>(data: T, explicit?: boolean): boolean {
  if (typeof explicit === 'boolean') return explicit;
  if (data == null) return true;
  return Array.isArray(data) && data.length === 0;
}

export function reduceAsyncResource<T>(
  resource: AsyncResource<T>,
  event: AsyncResourceEvent<T>,
): AsyncResource<T> {
  if (event.type === 'context') {
    if (event.contextKey === resource.contextKey) return resource;
    return idleAsyncResource<T>(event.contextKey);
  }

  if (event.type === 'start') {
    if (event.contextKey !== resource.contextKey) {
      return {
        data: null,
        status: 'loading',
        error: null,
        updatedAt: null,
        contextKey: event.contextKey,
      };
    }
    const soft = Boolean(event.soft) && resource.data != null;
    return {
      ...resource,
      status: soft ? 'refreshing' : 'loading',
      error: soft ? resource.error : null,
    };
  }

  if (event.contextKey !== resource.contextKey) return resource;

  if (event.type === 'success') {
    const empty = isEmptyValue(event.data, event.empty);
    return {
      data: event.data,
      status: event.stale ? 'stale' : empty ? 'empty' : 'success',
      error: null,
      updatedAt: event.at ?? Date.now(),
      contextKey: event.contextKey,
    };
  }

  const error = normalizeAppError(event.error, { offline: event.offline });
  if (event.offline) {
    if (resource.data != null) {
      return { ...resource, status: 'offline', error };
    }
    return {
      data: null,
      status: 'offline',
      error,
      updatedAt: null,
      contextKey: event.contextKey,
    };
  }

  if (resource.data != null) {
    return { ...resource, status: 'stale', error };
  }

  return {
    data: null,
    status: 'error',
    error,
    updatedAt: null,
    contextKey: event.contextKey,
  };
}

export function asyncHasData<T>(resource: AsyncResource<T>): boolean {
  return resource.data != null;
}

export function asyncShowEmpty<T>(resource: AsyncResource<T>): boolean {
  return resource.status === 'empty';
}

export function asyncShowError<T>(resource: AsyncResource<T>): boolean {
  return resource.status === 'error' || (resource.status === 'offline' && resource.data == null);
}

export function asyncShowStale<T>(resource: AsyncResource<T>): boolean {
  return resource.status === 'stale' || (resource.status === 'offline' && resource.data != null);
}

export function asyncIsLoading<T>(resource: AsyncResource<T>): boolean {
  return resource.status === 'idle' || resource.status === 'loading';
}
