/** Догружает pending_payments для проектов на 100%, если backend не отдал в listProjects */
import { api, type ProjectSummary, type UserRole } from '@/lib/api';
import { reportError } from '@/lib/reportError';

/** Чистое слияние — для unit-тестов без API */
export function applyPendingPaymentCounts(
  projects: ProjectSummary[],
  countsById: Record<string, number>,
): ProjectSummary[] {
  return projects.map((p) =>
    p.pending_payments != null
      ? p
      : countsById[p.id] != null
        ? { ...p, pending_payments: countsById[p.id] }
        : p,
  );
}

/**
 * Resolves pending-payment counts for a set of project ids without ever fabricating
 * a `0` for a failed read: a rejected `fetchCount` is reported via `onError` and simply
 * omitted from the result, leaving that project's count unconfirmed.
 *
 * Pure aside from the injected `fetchCount`/`onError` — unit-testable without mocking
 * the `api` module.
 */
export async function resolveConfirmedPendingPayments(
  ids: string[],
  fetchCount: (id: string) => Promise<number>,
  onError: (id: string, error: unknown) => void,
): Promise<Record<string, number>> {
  const rows = await Promise.all(
    ids.map(async (id) => {
      try {
        const n = (await fetchCount(id)) || 0;
        return [id, n] as const;
      } catch (error) {
        onError(id, error);
        return null;
      }
    }),
  );
  return Object.fromEntries(rows.filter((row): row is readonly [string, number] => row != null));
}

export async function enrichProjectsPendingPayments(
  userId: string,
  projects: ProjectSummary[],
  role: UserRole,
): Promise<ProjectSummary[]> {
  if (role !== 'customer') return projects;

  const closing = projects.filter((p) => p.progress_percent >= 100 && p.pending_payments == null);
  if (!closing.length) return projects;

  // A failed read is not zero pending payments — leave it unconfirmed so
  // formatProjectPhaseLabel keeps reporting "Закрытие", not "Завершён".
  const confirmed = await resolveConfirmedPendingPayments(
    closing.map((p) => p.id),
    (id) => api.countPendingPayments(userId, id),
    (id, error) => reportError('enrichProjectsPendingPayments.countPendingPayments', error, { userId, projectId: id }),
  );
  return applyPendingPaymentCounts(projects, confirmed);
}
