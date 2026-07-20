/** Миграция лимита: локальный кэш ↔ API */
import { api } from '@/lib/api';
import { getCustomerBudget, setCustomerBudget } from '@/lib/customerBudgetPrefs';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { normalizeCustomerBudget } from '@/lib/customerBudgetSync';

/** После загрузки проекта — синхронизация лимита между устройствами */
export async function syncCustomerBudgetOnLoad(
  userId: string,
  projectId: string,
  serverValue: unknown,
): Promise<number | null> {
  const server = normalizeCustomerBudget(serverValue);
  const local = await getCustomerBudget(projectId);

  if (server) {
    if (local !== server) await setCustomerBudget(projectId, server);
    return server;
  }

  if (local) {
    try {
      await api.patchProject(userId, projectId, { customer_budget: local });
      await syncProjectSideEffects({ user: { id: userId } as any, project: { id: projectId } as any });
      return local;
    } catch {
      return local;
    }
  }

  return null;
}
