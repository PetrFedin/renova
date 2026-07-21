import type { AsyncResource, AsyncResourceAction } from './types';

export function createAsyncResource<T>(projectId: string | null = null): AsyncResource<T> {
  return {
    status: 'idle',
    data: undefined,
    error: null,
    projectId,
    requestId: 0,
    stale: false,
  };
}

/** Сообщение для UI / reportError. */
export function formatLoadError(error: unknown, fallback = 'Не удалось загрузить данные'): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
}

export function isInitialPending(status: AsyncResource<unknown>['status']): boolean {
  return status === 'idle' || status === 'loading';
}

export function hasLoadedData<T>(res: AsyncResource<T>): res is AsyncResource<T> & { data: T } {
  return res.data !== undefined;
}

export function isEmptySuccessList<T>(res: AsyncResource<T[]>): boolean {
  return res.status === 'success' && Array.isArray(res.data) && res.data.length === 0;
}

export type BeginFetchAction = {
  type: 'begin_fetch';
  projectId: string;
  requestId: number;
};

export type AsyncResourceActionExt<T> = AsyncResourceAction<T> | BeginFetchAction;

/**
 * Reducer: смена project сбрасывает данные; refresh error сохраняет data + stale;
 * ответы с чужим projectId / requestId игнорируются.
 */
export function asyncResourceReducer<T>(
  state: AsyncResource<T>,
  action: AsyncResourceActionExt<T>,
): AsyncResource<T> {
  switch (action.type) {
    case 'bind_project': {
      if (action.projectId === state.projectId) return state;
      return createAsyncResource<T>(action.projectId);
    }
    case 'begin_fetch': {
      // Если project сменился до bind — начинаем с чистого ресурса
      const base =
        action.projectId === state.projectId ? state : createAsyncResource<T>(action.projectId);
      if (base.data !== undefined) {
        return {
          ...base,
          status: 'refreshing',
          error: null,
          requestId: action.requestId,
          stale: false,
        };
      }
      return {
        ...base,
        status: 'loading',
        error: null,
        requestId: action.requestId,
        stale: false,
      };
    }
    case 'load_start': {
      if (action.projectId !== state.projectId) return state;
      return {
        ...state,
        status: 'loading',
        error: null,
        requestId: action.requestId,
        stale: false,
      };
    }
    case 'refresh_start': {
      if (action.projectId !== state.projectId) return state;
      return {
        ...state,
        status: 'refreshing',
        error: null,
        requestId: action.requestId,
        stale: false,
      };
    }
    case 'success': {
      if (action.projectId !== state.projectId) return state;
      if (action.requestId !== state.requestId) return state;
      return {
        ...state,
        status: 'success',
        data: action.data,
        error: null,
        stale: false,
      };
    }
    case 'error': {
      if (action.projectId !== state.projectId) return state;
      if (action.requestId !== state.requestId) return state;
      const keep = state.data !== undefined;
      return {
        ...state,
        status: 'error',
        error: action.message,
        data: state.data,
        stale: keep,
      };
    }
    default:
      return state;
  }
}

export function nextRequestId(state: AsyncResource<unknown>): number {
  return state.requestId + 1;
}

/** @deprecated prefer begin_fetch via hook — оставлено для unit-тестов startActionFor */
export function startActionFor<T>(
  state: AsyncResource<T>,
  projectId: string,
): { action: AsyncResourceActionExt<T>; requestId: number } {
  const requestId = nextRequestId(state);
  return { action: { type: 'begin_fetch', projectId, requestId }, requestId };
}
