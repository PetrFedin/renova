type TeamJoinResultLike = {
  ok?: unknown;
  team_id?: unknown;
  message?: unknown;
};

/**
 * The join endpoint intentionally returns business failures as HTTP 200 with
 * { ok: false, message }. Treat both those responses and malformed success
 * payloads as failures so onboarding cannot claim a team join that did not happen.
 */
export function requireSuccessfulTeamJoin(result: unknown): string {
  if (!result || typeof result !== 'object') {
    throw new Error('Сервер не подтвердил вступление в бригаду');
  }

  const value = result as TeamJoinResultLike;
  if (value.ok !== true) {
    const message = typeof value.message === 'string' && value.message.trim()
      ? value.message.trim()
      : 'Не удалось присоединиться к бригаде';
    throw new Error(message);
  }

  if (typeof value.team_id !== 'string' || !value.team_id.trim()) {
    throw new Error('Сервер не подтвердил бригаду');
  }

  return value.team_id;
}

/**
 * Достаёт токен приглашения из содержимого QR/ссылки: `renova://team/join/<token>`,
 * https-вариант или `/join/<token>`. Всё остальное — не приглашение (null).
 */
export function parseTeamInviteToken(data: unknown): string | null {
  if (typeof data !== 'string') return null;
  const m = data.trim().match(/(?:^|\/)join\/([A-Za-z0-9_-]{8,128})(?:[/?#]|$)/);
  return m ? m[1] : null;
}

/** Текст ошибки вступления: берём ответ сервера, иначе общий. */
export function teamJoinErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return raw.trim() || 'Не удалось присоединиться к бригаде';
}

/**
 * `/teams/invite` тоже отвечает 200 {ok:false,message} (неверный телефон, уже в бригаде) —
 * успех «приглашение отправлено» показываем только при ok === true (MKT-013).
 */
export function requireSuccessfulTeamInvite(result: unknown): void {
  const value = (result && typeof result === 'object' ? result : {}) as TeamJoinResultLike;
  if (value.ok === true) return;
  const message = typeof value.message === 'string' && value.message.trim()
    ? value.message.trim()
    : 'Не удалось отправить приглашение';
  throw new Error(message);
}
