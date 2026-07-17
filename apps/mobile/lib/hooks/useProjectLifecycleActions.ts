import { useCallback } from 'react';
import { Alert } from 'react-native';
import { useRenova } from '@/lib/context/RenovaContext';
import { api } from '@/lib/api';

/** Archive/trash/restore handlers shared by project pickers. */
export function useProjectLifecycleActions(reloadBuckets?: () => Promise<void>) {
  const { user, refreshProjects, activeProject, clearActiveProject } = useRenova();

  const afterMutation = useCallback(
    async (projectId: string) => {
      await refreshProjects();
      await reloadBuckets?.();
      if (activeProject?.id === projectId) {
        await clearActiveProject();
      }
    },
    [refreshProjects, reloadBuckets, activeProject?.id, clearActiveProject],
  );

  const confirmAction = useCallback((title: string, message: string, action: () => Promise<void>) => {
    Alert.alert(title, message, [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'OK',
        style: 'destructive',
        onPress: () => action().catch(() => Alert.alert('Ошибка', 'Не удалось выполнить действие')),
      },
    ]);
  }, []);

  const lifecycleHandlers = useCallback(
    (id: string) => ({
      onArchive: () =>
        confirmAction('В архив?', 'Объект скроется из списка, данные сохранятся.', async () => {
          if (!user) return;
          await api.archiveProject(user.id, id);
          await afterMutation(id);
        }),
      onTrash: () =>
        confirmAction('В корзину?', 'Объект можно восстановить из корзины.', async () => {
          if (!user) return;
          await api.trashProject(user.id, id);
          await afterMutation(id);
        }),
      onUnarchive: () =>
        confirmAction('Из архива?', 'Объект снова появится в списке.', async () => {
          if (!user) return;
          await api.unarchiveProject(user.id, id);
          await refreshProjects();
          await reloadBuckets?.();
        }),
      onRestore: () =>
        confirmAction('Восстановить?', 'Объект вернётся в активные.', async () => {
          if (!user) return;
          await api.restoreProject(user.id, id);
          await refreshProjects();
          await reloadBuckets?.();
        }),
      onPurge: () =>
        confirmAction('Удалить навсегда?', 'Данные объекта будут удалены без возможности восстановления.', async () => {
          if (!user) return;
          await api.purgeProject(user.id, id);
          await afterMutation(id);
        }),
    }),
    [user, confirmAction, afterMutation, refreshProjects, reloadBuckets],
  );

  const emptyTrash = useCallback(
    () =>
      confirmAction('Очистить корзину?', 'Все объекты в корзине будут удалены навсегда.', async () => {
        if (!user) return;
        await api.emptyProjectTrash(user.id);
        await refreshProjects();
        await reloadBuckets?.();
      }),
    [user, confirmAction, refreshProjects, reloadBuckets],
  );

  return { lifecycleHandlers, emptyTrash };
}
