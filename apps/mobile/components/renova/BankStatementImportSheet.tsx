/** W123: импорт банковской выписки → сопоставление → подтверждение оплат → бюджет (Smetter/Gectaro) */
import { useState } from 'react';
import { TextInput } from 'react-native';
import { SheetSurface, sheetContentStyles } from '@/components/renova/SheetSurface';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { api } from '@/lib/api';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { pushOsNav } from '@/lib/pushOsNav';
import { budgetTabRoute, type OsRole } from '@/constants/osSections';
import { showActionConfirm } from '@/lib/actionConfirmBus';
import { writeResultMessage } from '@/lib/offlineResultMessage';

type Props = {
  visible: boolean;
  onClose: () => void;
  userId: string;
  projectId: string;
  role: OsRole;
  /** После успешного confirm / расходов — обновить список оплат на экране */
  onDone?: () => void;
};

export function BankStatementImportSheet({
  visible, onClose, userId, projectId, role, onDone,
}: Props) {
  const { user, activeProject } = useRenova();
  const [csv, setCsv] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const sync = async () => {
    await syncProjectSideEffects({
      user: user ?? ({ id: userId } as any),
      project: activeProject ?? ({ id: projectId } as any),
      role,
    });
  };

  const goPayments = () => {
    pushOsNav(budgetTabRoute(role, 'payments'), '/documents', role);
    onDone?.();
  };

  const goExpenses = () => {
    pushOsNav(budgetTabRoute(role, 'expenses'), '/documents', role);
    onDone?.();
  };

  /** Clarity P: post-import decisions через sheet, не nested Alert */
  const askExpenses = (csvText: string, unmatched: number) => {
    if (unmatched <= 0) {
      onDone?.();
      return;
    }
    showActionConfirm({
      title: 'Расходы из выписки',
      message: `${unmatched} строк без счёта. Создать расходы в бюджете?`,
      primaryLabel: 'Создать расходы',
      onPrimary: () => {
        setBusy('expenses');
        api.importBankStatement(userId, projectId, csvText, { create_expenses: true })
          .then(async (r2) => {
            await sync();
            const replayed = r2.expenses_replayed ?? 0;
            showActionConfirm({
              title: 'Бюджет',
              message: `Создано расходов: ${r2.expenses_created ?? 0} · уже были учтены: ${replayed}.`,
              primaryLabel: 'К расходам',
              onPrimary: goExpenses,
              secondaryLabel: 'Готово',
              onSecondary: () => onDone?.(),
            });
          })
          .catch((e: unknown) => {
            showActionConfirm({
              title: 'Ошибка',
              message: writeResultMessage(e, 'Не удалось создать расходы'),
            });
          })
          .finally(() => setBusy(null));
      },
      secondaryLabel: 'Нет',
      onSecondary: () => onDone?.(),
    });
  };

  const submit = async () => {
    if (busy) return;
    const text = csv.trim();
    if (!text) {
      showActionConfirm({
        title: 'Импорт выписки',
        message: 'Вставьте CSV: дата;сумма;назначение',
      });
      return;
    }
    setBusy('import');
    try {
      const res = await api.importBankStatement(userId, projectId, text);
      setCsv('');
      onClose();
      await sync();

      const pendingIds = (res.matches || [])
        .filter((m) => m.payment_status === 'pending')
        .map((m) => m.payment_id);
      const confirmableIds = role === 'customer' ? pendingIds : [];
      const unmatched = res.unmatched_rows || 0;
      const summary = `Строк: ${res.parsed_rows} · совпало: ${res.matched} · без пары: ${unmatched}`;

      if (!confirmableIds.length) {
        showActionConfirm({
          title: 'Импорт выписки',
          message: role === 'customer' ? summary : `${summary}\n\nПодтверждает оплаты заказчик.`,
          actions: [
            ...(res.matched > 0
              ? [{ label: 'К оплатам', onPress: goPayments }]
              : []),
            { label: 'Дальше', onPress: () => askExpenses(text, unmatched) },
          ],
        });
        return;
      }

      const matchToken = res.match_token;
      if (!matchToken) {
        showActionConfirm({
          title: 'Импорт выписки',
          message: 'Сервер не выдал подтверждение сопоставления. Загрузите выписку снова.',
        });
        return;
      }

      showActionConfirm({
        title: 'Подтвердить оплаты?',
        message: `${summary}\n\nПодтвердить оплаты, ожидающие подтверждения: ${confirmableIds.length}? Для этого этап должен быть принят.`,
        actions: [
          {
            label: 'Подтвердить',
            onPress: () => {
              setBusy('confirm');
              api.confirmBankStatementMatches(userId, projectId, confirmableIds, matchToken)
                .then(async (r) => {
                  await sync();
                  showActionConfirm({
                    title: 'Выписка → оплаты',
                    message: `Подтверждено: ${r.confirmed_count} · уже подтверждено: ${r.replayed_count} · не подтверждено (этап не принят): ${r.blocked_count}`,
                    actions: [
                      ...(r.confirmed_count > 0 || r.replayed_count > 0
                        ? [{ label: 'К оплатам', onPress: goPayments }]
                        : []),
                      { label: 'Дальше', onPress: () => askExpenses(text, unmatched) },
                    ],
                  });
                })
                .catch((e: unknown) => {
                  showActionConfirm({
                    title: 'Ошибка',
                    message: writeResultMessage(e, 'Не удалось подтвердить'),
                  });
                })
                .finally(() => setBusy(null));
            },
          },
          {
            label: 'Только сопоставить',
            onPress: () => askExpenses(text, unmatched),
          },
        ],
      });
    } catch (e: unknown) {
      showActionConfirm({
        title: 'Ошибка',
        message: writeResultMessage(e, 'Не удалось импортировать'),
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <SheetSurface
      visible={visible}
      onClose={onClose}
      busy={!!busy}
      title="Импорт банковской выписки"
      subtitle="Формат: дата;сумма;назначение. Совпавшие неоплаченные счета можно подтвердить (как в 1С/банке)."
      footer={
        <>
          <PrimaryButton title="Импортировать" onPress={() => { void submit(); }} loading={!!busy} disabled={!!busy} />
          <PrimaryButton title="Отмена" variant="ghost" onPress={onClose} disabled={!!busy} />
        </>
      }
    >
      <TextInput
        style={[sheetContentStyles.input, { minHeight: 140 }]}
        multiline
        placeholder={'2026-07-01;150000;Оплата этапа черновые\n...'}
        value={csv}
        onChangeText={setCsv}
        textAlignVertical="top"
        editable={!busy}
      />
    </SheetSurface>
  );
}
