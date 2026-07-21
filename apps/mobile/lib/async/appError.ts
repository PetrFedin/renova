/**
 * Нормализованная ошибка для UI.
 * Не содержит stack / сырой backend detail — только kind + безопасный текст.
 */
export type AppErrorKind =
  | 'network'
  | 'timeout'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'validation'
  | 'server'
  | 'offline'
  | 'unknown';

export type AppError = {
  kind: AppErrorKind;
  /** Короткий текст для пользователя (RU) */
  message: string;
  status?: number;
  retryable: boolean;
};

const SAFE: Record<AppErrorKind, string> = {
  network: 'Нет связи с сервером. Проверьте интернет и повторите.',
  timeout: 'Сервер не ответил вовремя. Попробуйте ещё раз.',
  unauthorized: 'Сессия истекла. Войдите снова.',
  forbidden: 'Недостаточно прав для этого действия.',
  not_found: 'Данные не найдены или были удалены.',
  validation: 'Запрос отклонён. Обновите экран и попробуйте снова.',
  server: 'Сервер временно недоступен. Попробуйте позже.',
  offline: 'Нет сети. Показаны сохранённые данные или повторите позже.',
  unknown: 'Не удалось загрузить данные. Повторите попытку.',
};

function statusToKind(status: number): AppErrorKind {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 408 || status === 504) return 'timeout';
  if (status === 422 || status === 400) return 'validation';
  if (status >= 500) return 'server';
  if (status === 0) return 'network';
  return 'unknown';
}

function isRetryable(kind: AppErrorKind): boolean {
  return kind === 'network'
    || kind === 'timeout'
    || kind === 'server'
    || kind === 'offline'
    || kind === 'unknown';
}

/**
 * Превращает любой thrown value в AppError без утечки внутренних деталей.
 */
export function normalizeAppError(err: unknown, opts?: { offline?: boolean }): AppError {
  if (opts?.offline) {
    return {
      kind: 'offline',
      message: SAFE.offline,
      retryable: true,
    };
  }

  if (err && typeof err === 'object') {
    const e = err as {
      status?: unknown;
      code?: unknown;
      message?: unknown;
      name?: unknown;
    };
    const status = typeof e.status === 'number' ? e.status : undefined;
    const msg = typeof e.message === 'string' ? e.message.toLowerCase() : '';
    const code = typeof e.code === 'string' ? e.code.toLowerCase() : '';

    if (
      e.name === 'AbortError'
      || code === 'timeout'
      || msg.includes('timeout')
      || msg.includes('timed out')
    ) {
      return { kind: 'timeout', message: SAFE.timeout, status, retryable: true };
    }

    if (
      e.name === 'TypeError'
      || code === 'network'
      || /network|fetch failed|failed to fetch|net::/.test(msg)
    ) {
      return { kind: 'network', message: SAFE.network, status: status ?? 0, retryable: true };
    }

    if (status != null) {
      const kind = statusToKind(status);
      return {
        kind,
        message: SAFE[kind],
        status,
        retryable: isRetryable(kind),
      };
    }
  }

  return {
    kind: 'unknown',
    message: SAFE.unknown,
    retryable: true,
  };
}

/** Текст для InlineError / баннера */
export function appErrorMessage(error: AppError | null | undefined): string {
  return error?.message || SAFE.unknown;
}
