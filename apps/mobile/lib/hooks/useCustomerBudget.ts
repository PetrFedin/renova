import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getCustomerBudget, setCustomerBudget } from '@/lib/customerBudgetPrefs';
import { normalizeCustomerBudget, resolveCustomerBudget } from '@/lib/customerBudgetSync';

type Options = {
  projectId?: string | null;
  userId?: string | null;
  /** Значение с сервера (activeProject.customer_budget) */
  serverBudget?: number | null;
};

export function useCustomerBudget({ projectId, userId, serverBudget }: Options) {
  const [local, setLocal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId) {
      setLocal(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    getCustomerBudget(projectId)
      .then(setLocal)
      .catch(() => setLocal(null))
      .finally(() => setLoading(false));
  }, [projectId]);

  const customerBudget = resolveCustomerBudget(serverBudget, local);

  const saveCustomerBudget = useCallback(
    async (amount: number | null) => {
      if (!projectId) return null;
      const rounded = normalizeCustomerBudget(amount);

      if (userId) {
        try {
          const p = await api.patchProject(userId, projectId, { customer_budget: rounded });
          const synced = normalizeCustomerBudget(p.customer_budget) ?? rounded;
          await setCustomerBudget(projectId, synced);
          setLocal(synced);
          await syncProjectSideEffects({
            user: { id: userId } as any,
            project: { id: projectId, customer_budget: synced } as any,
          });
          return synced;
        } catch {
          await setCustomerBudget(projectId, rounded);
          setLocal(rounded);
          return rounded;
        }
      }

      await setCustomerBudget(projectId, rounded);
      setLocal(rounded);
      return rounded;
    },
    [projectId, userId],
  );

  return { customerBudget, loading, saveCustomerBudget };
}
