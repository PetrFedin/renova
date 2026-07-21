import { useCallback } from 'react';
import { useRenova } from '@/lib/context/RenovaContext';
import { ApiError, api, invalidateProjectsCache } from '@/lib/api';
import { dropJobsForProject } from '@/lib/offlineQueue';
import { notifyProjectDataChanged } from '@/lib/projectDataBus';
import { alertMessage, confirmDestructive } from '@/lib/confirmAlert';
import { reportCatch } from '@/lib/reportError';

/** Archive/trash/restore handlers shared by project pickers. */
export function useProjectLifecycleActions(reloadBuckets?: () => Promise<void>) {
  const { user, refreshProjects, activeProject, clearActiveProject } = useRenova();

  const afterMutation = useCallback(
    async (projectId: string) => {
      if (user) await invalidateProjectsCache(user.id);
      await dropJobsForProject(projectId).catch(reportCatch('lib.hooks.useProjectLifecycleActions.1'));
      await refreshProjects();
      await reloadBuckets?.();
      if (activeProject?.id === projectId) {
        await clearActiveProject();
      }
      // W94: home/inbox после archive/trash (очередь уже notify через dropJobs)
      notifyProjectDataChanged();
    },
    [user, refreshProjects, reloadBuckets, activeProject?.id, clearActiveProject],
  );

  const refreshAfterMutation = useCallback(
    async (projectId?: string) => {
      if (user) await invalidateProjectsCache(user.id);
      await refreshProjects();
      await reloadBuckets?.();
      if (projectId && activeProject?.id === projectId) {
        await clearActiveProject();
      }
      notifyProjectDataChanged();
    },
    [user, refreshProjects, reloadBuckets, activeProject?.id, clearActiveProject],
  );

  const runMutation = useCallback(
    async (mutate: () => Promise<void>, refresh: () => Promise<void>) => {
      try {
        await mutate();
      } catch (error) {
        console.warn('[project-lifecycle]', error);
        const message =
          error instanceof ApiError && error.message.trim()
            ? error.message
            : 'Не удалось выполнить действие';
        alertMessage('Ошибка', message);
        return;
      }
      try {
        await refresh();
      } catch (error) {
        console.warn('[project-lifecycle] refresh failed', error);
        alertMessage(
          'Внимание',
          'Действие выполнено, но список объектов мог не обновиться. Потяните экран вниз.',
        );
      }
    },
    [],
  );

  const confirmAction = useCallback(
    async (title: string, message: string, mutate: () => Promise<void>, refresh: () => Promise<void>) => {
      const ok = await confirmDestructive(title, message);
      if (!ok) return;
      await runMutation(mutate, refresh);
    },
    [runMutation],
  );

  const lifecycleHandlers = useCallback(
    (id: string) => ({
      onArchive: () =>
        confirmAction(
          'В архив?',
          'Объект скроется из списка, данные сохранятся.',
          async () => {
            if (!user) return;
            await api.archiveProject(user.id, id);
          },
          () => afterMutation(id),
        ),
      onTrash: () =>
        confirmAction('В корзину?', 'Объект можно восстановить из корзины.', async () => {
          if (!user) return;
          await api.trashProject(user.id, id);
        }, () => afterMutation(id)),
      onUnarchive: () =>
        confirmAction('Из архива?', 'Объект снова появится в списке.', async () => {
          if (!user) return;
          await api.unarchiveProject(user.id, id);
        }, () => refreshAfterMutation()),
      onRestore: () =>
        confirmAction('Восстановить?', 'Объект вернётся в активные.', async () => {
          if (!user) return;
          await api.restoreProject(user.id, id);
        }, () => refreshAfterMutation()),
      onPurge: () =>
        confirmAction(
          'Удалить навсегда?',
          'Данные объекта будут удалены без возможности восстановления.',
          async () => {
            if (!user) return;
            await api.purgeProject(user.id, id);
          },
          () => afterMutation(id),
        ),
    }),
    [user, confirmAction, afterMutation, refreshAfterMutation],
  );

  const emptyTrash = useCallback(
    () =>
      confirmAction('Очистить корзину?', 'Все объекты в корзине будут удалены навсегда.', async () => {
        if (!user) return;
        await api.emptyProjectTrash(user.id);
      }, () => refreshAfterMutation()),
    [user, confirmAction, refreshAfterMutation],
  );

  return { lifecycleHandlers, emptyTrash };
}
