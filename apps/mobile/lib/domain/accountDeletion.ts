/** ROLE-016 / APIA-006: удаление аккаунта — чистая логика текстов и разбора ответа сервера. */

export type DeletionBlocker = { code: string; count: number };

const BLOCKER_TEXT: Record<string, (n: number) => string> = {
  active_projects: (n) =>
    `Активных проектов с исполнителем: ${n}. Завершите или архивируйте их, прежде чем удалять аккаунт.`,
  unsettled_payments: (n) =>
    `Незавершённых платежей: ${n}. Дождитесь подтверждения или отмены всех счетов и споров.`,
};

export function blockerLines(blockers: DeletionBlocker[]): string[] {
  return blockers.map((b) => (BLOCKER_TEXT[b.code] ? BLOCKER_TEXT[b.code](b.count) : `Мешает: ${b.code} (${b.count}).`));
}

/** Достаёт blockers из ApiError 409 (detail = { code, blockers }) или возвращает null. */
export function extractBlockers(error: unknown): DeletionBlocker[] | null {
  const e = error as { status?: number; detail?: unknown } | null;
  if (!e || e.status !== 409) return null;
  const d = e.detail as { code?: string; blockers?: unknown } | undefined;
  if (!d || d.code !== 'account_deletion_blocked' || !Array.isArray(d.blockers)) return null;
  return d.blockers
    .filter((b): b is DeletionBlocker => !!b && typeof (b as DeletionBlocker).code === 'string')
    .map((b) => ({ code: b.code, count: Number(b.count) || 0 }));
}

export const DELETE_CONFIRM_MESSAGE =
  'Аккаунт будет анонимизирован: имя, телефон и ИНН удалятся, вы выйдете на всех устройствах, ' +
  'портал-ссылки и push-уведомления перестанут работать. Данные проектов, где вы участвовали, сохранятся в обезличенном виде. ' +
  'Действие нельзя отменить.';
