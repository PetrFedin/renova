/** Явные статусы независимого источника данных (не смешивать null). */
export type ResourceStatus = 'idle' | 'loading' | 'refreshing' | 'success' | 'error';

/**
 * data === undefined — ещё не было успешного ответа для текущего projectId.
 * После success data всегда задан (в т.ч. null / [] как валидный пустой результат).
 * stale — показали предыдущие данные после ошибки refresh.
 */
export type AsyncResource<T> = {
  status: ResourceStatus;
  data: T | undefined;
  error: string | null;
  projectId: string | null;
  /** Монотонный id запроса; ответы со старым id игнорируются. */
  requestId: number;
  stale: boolean;
};

export type AsyncResourceAction<T> =
  | { type: 'bind_project'; projectId: string | null }
  | { type: 'load_start'; projectId: string; requestId: number }
  | { type: 'refresh_start'; projectId: string; requestId: number }
  | { type: 'success'; projectId: string; requestId: number; data: T }
  | { type: 'error'; projectId: string; requestId: number; message: string };
