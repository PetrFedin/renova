/** Marketplace conversion recovery operations; never repeat the conversion. */
export async function loadQuotedLead<T extends { id: string; status: string }>(
  listLeads: (status: 'quoted') => Promise<T[]>,
  leadId: string,
): Promise<T | null> {
  const rows = await listLeads('quoted');
  return rows.find((row) => row.id === leadId && row.status === 'quoted') ?? null;
}

export type ConvertedLeadProject = { project_id: string; name: string };

type RefreshOutcome = { refreshFailed: boolean; refreshError?: unknown };
export type OpenConvertedProjectOutcome = RefreshOutcome & (
  | { kind: 'load_completed' }
  | { kind: 'open_failed'; openError: unknown }
  | { kind: 'cancelled' }
);

export type OpenConvertedProjectPorts = {
  refreshProjects: () => Promise<unknown>;
  loadProject: (projectId: string) => Promise<unknown>;
  isCurrent?: () => boolean;
};

/**
 * A confirmed conversion stays confirmed when refresh/loading fails. Retrying
 * this function cannot call convertJobLead. The shared loadProject port still
 * owns compatibility assignment, active-project selection and propagation.
 * Its resolved promise alone is NOT proof that selection succeeded: callers
 * must also match the active-project identity before navigating (the existing
 * context can swallow rate-limit errors). Stop follow-up after a scope change.
 */
export async function openConvertedProject(
  projectId: string,
  ports: OpenConvertedProjectPorts,
): Promise<OpenConvertedProjectOutcome> {
  const isCurrent = ports.isCurrent ?? (() => true);
  const refresh: RefreshOutcome = { refreshFailed: false };
  if (!isCurrent()) return { ...refresh, kind: 'cancelled' };
  try {
    await ports.refreshProjects();
  } catch (error) {
    refresh.refreshFailed = true;
    refresh.refreshError = error;
  }
  if (!isCurrent()) return { ...refresh, kind: 'cancelled' };
  try {
    await ports.loadProject(projectId);
  } catch (error) {
    if (!isCurrent()) return { ...refresh, kind: 'cancelled' };
    return { ...refresh, kind: 'open_failed', openError: error };
  }
  if (!isCurrent()) return { ...refresh, kind: 'cancelled' };
  return { ...refresh, kind: 'load_completed' };
}
