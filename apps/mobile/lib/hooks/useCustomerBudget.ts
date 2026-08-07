import { useCallback, useEffect, useState } from 'react';
import { api, type ProjectDetail, type User } from '@/lib/api';
import { getCustomerBudget, setCustomerBudget } from '@/lib/customerBudgetPrefs';
import { normalizeCustomerBudget, resolveCustomerBudget } from '@/lib/customerBudgetSync';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { reportError } from '@/lib/reportError';

type BudgetSyncState = 'synced' | 'local_only' | 'idle';

type Options = {
  projectId?: string | null;
  userId?: string | null;
  /** Значение с сервера (activeProject.customer_budget) */
  serverBudget?: number | null;
  /** Реальный context нужен только для post-commit buses; ids отдельно остаются API boundary. */
  user?: User | null;
  project?: ProjectDetail | null;
};

export function useCustomerBudget({ projectId, userId, serverBudget, user, project }: Options) {
  const [local, setLocal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncState, setSyncState] = useState<BudgetSyncState>('idle');

  useEffect(() => {
    if (!projectId) {
      setLocal(null);
      setLoading(false);
      setSyncState('idle');
      return;
    }
    setLoading(true);
    getCustomerBudget(projectId)
      .then(setLocal)
      .catch((error) => {
        reportError('customerBudget.readLocal', error, { projectId });
        setLocal(null);
      })
      .finally(() => setLoading(false));
  }, [projectId]);

  const customerBudget = resolveCustomerBudget(serverBudget, local);

  const saveCustomerBudget = useCallback(
    async (amount: number | null) => {
      if (!projectId) return null;
      const rounded = normalizeCustomerBudget(amount);

      if (userId) {
        try {
          const committed = await api.patchProject(userId, projectId, { customer_budget: rounded });
          const synced = normalizeCustomerBudget(committed.customer_budget) ?? rounded;
          await setCustomerBudget(projectId, synced);
          setLocal(synced);
          setSyncState('synced');

          if (user?.id === userId && project?.id === projectId) {
            try {
              await syncProjectSideEffects({ user, project: committed });
            } catch (error) {
              reportError('customerBudget.save.sideEffects', error, { projectId });
            }
          }
          return synced;
        } catch (error) {
          // Preserve offline/local editing, but expose and report that the
          // value is not yet confirmed by the server.
          reportError('customerBudget.save.remote', error, { projectId });
          await setCustomerBudget(projectId, rounded);
          setLocal(rounded);
          setSyncState('local_only');
          return rounded;
        }
      }

      await setCustomerBudget(projectId, rounded);
      setLocal(rounded);
      setSyncState('local_only');
      return rounded;
    },
    [projectId, userId, user, project],
  );

  return { customerBudget, loading, saveCustomerBudget, syncState };
}
