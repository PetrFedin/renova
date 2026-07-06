/** Догружает pending_payments для проектов на 100%, если backend не отдал в listProjects */
import { api, type ProjectSummary, type UserRole } from '@/lib/api';

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

export async function enrichProjectsPendingPayments(
  userId: string,
  projects: ProjectSummary[],
  role: UserRole,
): Promise<ProjectSummary[]> {
  if (role !== 'customer') return projects;

  const closing = projects.filter((p) => p.progress_percent >= 100 && p.pending_payments == null);
  if (!closing.length) return projects;

  const rows = await Promise.all(
    closing.map(async (p) => {
      try {
        const n = (await api.countPendingPayments(userId, p.id)) || 0;
        return [p.id, n] as const;
      } catch {
        return [p.id, 0] as const;
      }
    }),
  );

  return applyPendingPaymentCounts(projects, Object.fromEntries(rows));
}
