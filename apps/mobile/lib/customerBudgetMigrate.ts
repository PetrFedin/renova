/** Миграция лимита: локальный кэш ↔ API */
import { api, type ProjectDetail, type User } from '@/lib/api';
import { getCustomerBudget, setCustomerBudget } from '@/lib/customerBudgetPrefs';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { normalizeCustomerBudget } from '@/lib/customerBudgetSync';
import { reportError } from '@/lib/reportError';

/**
 * После загрузки проекта синхронизирует legacy local-only лимит с API.
 * Возвращает только подтверждённый сервером ProjectDetail: локальный fallback
 * никогда не подменяет поле `activeProject.customer_budget`.
 */
export async function syncCustomerBudgetOnLoad(
  user: User,
  project: ProjectDetail,
): Promise<ProjectDetail> {
  const server = normalizeCustomerBudget(project.customer_budget);
  let local: number | null = null;

  try {
    local = await getCustomerBudget(project.id);
  } catch (error) {
    reportError('customerBudget.migrate.readLocal', error, { projectId: project.id });
  }

  if (server) {
    if (local !== server) {
      try {
        await setCustomerBudget(project.id, server);
      } catch (error) {
        reportError('customerBudget.migrate.cacheServer', error, { projectId: project.id });
      }
    }
    return project;
  }

  if (!local) return project;

  let committed: ProjectDetail;
  try {
    committed = await api.patchProject(user.id, project.id, { customer_budget: local });
  } catch (error) {
    // Keep the legacy local value available through resolveCustomerBudget(),
    // but do not pretend it was persisted remotely.
    reportError('customerBudget.migrate.persist', error, { projectId: project.id });
    return project;
  }

  const persisted = normalizeCustomerBudget(committed.customer_budget);
  if (!persisted) {
    reportError(
      'customerBudget.migrate.contractMismatch',
      new Error('Committed customer budget was not returned by project API'),
      { projectId: project.id },
    );
  }

  try {
    await setCustomerBudget(project.id, persisted ?? local);
  } catch (error) {
    reportError('customerBudget.migrate.cacheCommitted', error, { projectId: project.id });
  }

  try {
    await syncProjectSideEffects({ user, project: committed });
  } catch (error) {
    // The profile mutation already committed. Follow-up buses must not turn it
    // into a false persistence failure.
    reportError('customerBudget.migrate.sideEffects', error, { projectId: project.id });
  }

  return committed;
}
