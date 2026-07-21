/** W123: импорт банковской выписки → матч → confirm оплат → бюджет (Smetter/Gectaro) */
import { useState } from 'react';
import {
  View, Text, Modal, TextInput, Pressable, StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { api } from '@/lib/api';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { pushOsNav } from '@/lib/pushOsNav';
import { budgetTabRoute, type OsRole } from '@/constants/osSections';

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

  const askExpenses = (csvText: string, unmatched: number) => {
    if (unmatched <= 0) {
      onDone?.();
      return;
    }
    Alert.alert(
      'Расходы из выписки',
      `${unmatched} строк без счёта. Создать расходы в бюджете?`,
      [
        { text: 'Нет', style: 'cancel', onPress: () => onDone?.() },
        {
          text: 'Создать расходы',
          onPress: () => {
            setBusy('expenses');
            api.importBankStatement(userId, projectId, csvText, { create_expenses: true })
              .then(async (r2) => {
                await sync();
                Alert.alert(
                  'Бюджет',
                  `Создано расходов: ${r2.expenses_created ?? 0}.`,
                  [
                    { text: 'OK', style: 'cancel', onPress: () => onDone?.() },
                    { text: 'К расходам', onPress: goExpenses },
                  ],
                );
              })
              .catch((e: unknown) => {
                Alert.alert('Ошибка', e instanceof Error ? e.message : 'Не удалось создать расходы');
              })
              .finally(() => setBusy(null));
          },
        },
      ],
    );
  };

  const submit = async () => {
    const text = csv.trim();
    if (!text) {
      Alert.alert('Импорт выписки', 'Вставьте CSV: дата;сумма;назначение');
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
      const unmatched = res.unmatched_rows || 0;
      const summary = `Строк: ${res.parsed_rows} · совпало: ${res.matched} · без пары: ${unmatched}`;

      if (!pendingIds.length) {
        Alert.alert('Импорт выписки', summary, [
          { text: 'OK', onPress: () => askExpenses(text, unmatched) },
          ...(res.matched > 0 ? [{ text: 'К оплатам', onPress: goPayments }] : []),
        ]);
        return;
      }

      Alert.alert(
        'Импорт выписки',
        `${summary}\n\nПодтвердить ${pendingIds.length} pending-оплат(ы)? (gate: приёмка этапа)`,
        [
          { text: 'Только матч', style: 'cancel', onPress: () => askExpenses(text, unmatched) },
          {
            text: 'Подтвердить',
            onPress: () => {
              setBusy('confirm');
              api.confirmBankStatementMatches(userId, projectId, pendingIds)
                .then(async (r) => {
                  await sync();
                  Alert.alert(
                    'Выписка → оплаты',
                    `Подтверждено: ${r.confirmed_count} · заблокировано gate: ${r.blocked_count}`,
                    [
                      { text: 'OK', style: 'cancel', onPress: () => askExpenses(text, unmatched) },
                      ...(r.confirmed_count > 0
                        ? [{ text: 'К оплатам', onPress: () => { goPayments(); } }]
                        : []),
                    ],
                  );
                })
                .catch((e: unknown) => {
                  Alert.alert('Ошибка', e instanceof Error ? e.message : 'Не удалось подтвердить');
                })
                .finally(() => setBusy(null));
            },
          },
        ],
      );
    } catch (e: unknown) {
      Alert.alert('Ошибка', e instanceof Error ? e.message : 'Не удалось импортировать');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.card}>
          <Text style={s.title}>Импорт банковской выписки</Text>
          <Text style={s.hint}>
            Формат: дата;сумма;назначение. Совпавшие pending-счета можно подтвердить (как в 1С/банке).
          </Text>
          <TextInput
            style={s.input}
            multiline
            placeholder={'2026-07-01;150000;Оплата этапа черновые\n...'}
            value={csv}
            onChangeText={setCsv}
            textAlignVertical="top"
            editable={!busy}
          />
          <View style={s.actions}>
            <Pressable onPress={onClose} style={s.btnGhost} disabled={!!busy}>
              <Text style={s.btnGhostT}>Отмена</Text>
            </Pressable>
            <Pressable onPress={submit} style={s.btn} disabled={!!busy}>
              {busy ? (
                <ActivityIndicator color={RenovaTheme.colors.surface} />
              ) : (
                <Text style={s.btnT}>Импортировать</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: RenovaTheme.colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    paddingBottom: 28,
    gap: 10,
  },
  title: { fontSize: 17, fontWeight: '700', color: RenovaTheme.colors.text },
  hint: { fontSize: 13, color: RenovaTheme.colors.textMuted, lineHeight: 18 },
  input: {
    minHeight: 140,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: RenovaTheme.colors.text,
    backgroundColor: RenovaTheme.colors.background,
  },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 4 },
  btn: {
    backgroundColor: RenovaTheme.colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    minWidth: 120,
    alignItems: 'center',
  },
  btnT: { color: RenovaTheme.colors.surface, fontWeight: '700', fontSize: 14 },
  btnGhost: { paddingHorizontal: 12, paddingVertical: 10 },
  btnGhostT: { color: RenovaTheme.colors.textMuted, fontWeight: '600' },
});
