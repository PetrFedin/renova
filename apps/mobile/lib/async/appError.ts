/** Safe UI error taxonomy without backend details or stack traces. */
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
  message: string;
  status?: number;
  retryable: boolean;
};

const SAFE_MESSAGES: Record<AppErrorKind, string> = {
  network: 'Нет связи с сервером. Проверьте интернет и повторите.',
  timeout: 'Сервер не ответил вовремя. Попробуйте ещё раз.',
  unauthorized: 'Сессия истекла. Войдите снова.',
  forbidden: 'Недостаточно прав для этого действия.',
  not_found: 'Данные не найдены или были удалены.',
  validation: 'Запрос отклонён. Обновите экран и попробуйте снова.',
  server: 'Сервер временно недоступен. Попробуйте позже.',
  offline: 'Нет сети. Повторите после восстановления соединения.',
  unknown: 'Не удалось загрузить данные. Повторите попытку.',
};

function statusToKind(status: number): AppErrorKind {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 408 || status === 504) return 'timeout';
  if (status === 400 || status === 409 || status === 422) return 'validation';
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

export function normalizeAppError(error: unknown, options?: { offline?: boolean }): AppError {
  if (options?.offline) {
    return {
      kind: 'offline',
      message: SAFE_MESSAGES.offline,
      retryable: true,
    };
  }

  if (error && typeof error === 'object') {
    const candidate = error as {
      status?: unknown;
      code?: unknown;
      message?: unknown;
      name?: unknown;
    };
    const status = typeof candidate.status === 'number' ? candidate.status : undefined;
    const code = typeof candidate.code === 'string' ? candidate.code.toLowerCase() : '';
    const message = typeof candidate.message === 'string' ? candidate.message.toLowerCase() : '';

    if (
      candidate.name === 'AbortError'
      || code === 'timeout'
      || message.includes('timeout')
      || message.includes('timed out')
      || message.includes('не отвечает')
    ) {
      return {
        kind: 'timeout',
        message: SAFE_MESSAGES.timeout,
        status,
        retryable: true,
      };
    }

    if (
      candidate.name === 'TypeError'
      || code === 'network'
      || /network|fetch failed|failed to fetch|net::|недоступен/.test(message)
    ) {
      return {
        kind: 'network',
        message: SAFE_MESSAGES.network,
        status: status ?? 0,
        retryable: true,
      };
    }

    if (status != null) {
      const kind = statusToKind(status);
      return {
        kind,
        message: SAFE_MESSAGES[kind],
        status,
        retryable: isRetryable(kind),
      };
    }
  }

  return {
    kind: 'unknown',
    message: SAFE_MESSAGES.unknown,
    retryable: true,
  };
}
