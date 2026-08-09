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
