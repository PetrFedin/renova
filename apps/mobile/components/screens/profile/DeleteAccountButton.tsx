/** APIA-006 / ROLE-016: удаление аккаунта из профиля — проверка блокеров, затем подтверждение. */
import { useState } from 'react';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { api } from '@/lib/api';
import { useRenova } from '@/lib/context/RenovaContext';
import { showActionConfirm } from '@/lib/actionConfirmBus';
import { writeResultMessage } from '@/lib/offlineResultMessage';
import { blockerLines, DELETE_CONFIRM_MESSAGE, extractBlockers } from '@/lib/domain/accountDeletion';

export function DeleteAccountButton() {
  const { user, logout } = useRenova();
  const [busy, setBusy] = useState(false);

  const perform = async () => {
    if (!user?.id) return;
    setBusy(true);
    try {
      await api.deleteMyAccount(user.id);
      await logout();
    } catch (e) {
      const blockers = extractBlockers(e);
      showActionConfirm({
        title: blockers ? 'Нельзя удалить аккаунт' : 'Ошибка',
        message: blockers ? blockerLines(blockers).join('\n') : writeResultMessage(e, 'Не удалось удалить аккаунт'),
      });
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    if (!user?.id || busy) return;
    setBusy(true);
    try {
      const check = await api.accountDeletionCheck(user.id);
      if (!check.can_delete) {
        showActionConfirm({ title: 'Нельзя удалить аккаунт', message: blockerLines(check.blockers).join('\n') });
        return;
      }
    } catch (e) {
      showActionConfirm({ title: 'Ошибка', message: writeResultMessage(e, 'Не удалось проверить аккаунт') });
      return;
    } finally {
      setBusy(false);
    }
    showActionConfirm({
      title: 'Удалить аккаунт?',
      message: DELETE_CONFIRM_MESSAGE,
      primaryLabel: 'Удалить аккаунт',
      primaryDestructive: true,
      onPrimary: () => {
        void perform();
      },
      secondaryLabel: 'Отмена',
    });
  };

  return <PrimaryButton title={busy ? '…' : 'Удалить аккаунт'} variant="outline" disabled={busy} onPress={start} />;
}
