/** Снятые с учёта расходы: увидеть и вернуть в бюджет. */
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { formatRub, RenovaTheme } from '@/constants/Theme';
import { showActionConfirm } from '@/lib/actionConfirmBus';
import { api, type OsExpense } from '@/lib/api';
import { apiErrorMessage } from '@/lib/formatPhone';
import { isOfflineQueued, notifyOfflineQueued } from '@/lib/offlineUi';
import { reportError } from '@/lib/reportError';

export function RemovedExpensesPanel({
  userId,
  projectId,
  onRestored,
}: {
  userId: string;
  projectId: string;
  onRestored: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<OsExpense[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await api.osExpenses(userId, projectId, 'deleted');
      setItems(rows);
    } catch (error: unknown) {
      reportError('components.renova.budget.RemovedExpensesPanel.load', error);
      setItems([]);
      showActionConfirm({
        title: 'Список недоступен',
        message: apiErrorMessage(error, 'Не удалось загрузить снятые с учёта расходы.'),
      });
    } finally {
      setLoading(false);
    }
  }, [userId, projectId]);

  useEffect(() => {
    if (open && items === null) void load();
  }, [open, items, load]);

  const restore = async (expense: OsExpense) => {
    if (busyId) return;
    setBusyId(expense.id);
    try {
      await api.restoreOsExpense(userId, projectId, expense.id);
      setItems((prev) => (prev || []).filter((row) => row.id !== expense.id));
      onRestored();
      showActionConfirm({
        title: 'Расход вернулся в бюджет',
        message: `«${expense.title}» снова учитывается в фактических тратах.`,
      });
    } catch (error: unknown) {
      if (isOfflineQueued(error)) {
        notifyOfflineQueued('Возврат расхода');
        return;
      }
      showActionConfirm({
        title: 'Не удалось вернуть расход',
        message: apiErrorMessage(error, 'Попробуйте ещё раз.'),
      });
    } finally {
      setBusyId(null);
    }
  };

  if (!open) {
    return (
      <PrimaryButton
        title="Снятые с учёта расходы"
        variant="ghost"
        compact
        onPress={() => setOpen(true)}
      />
    );
  }

  return (
    <View style={s.box}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Свернуть снятые с учёта расходы"
        style={s.headRow}
        onPress={() => setOpen(false)}
      >
        <Text style={s.head}>Снятые с учёта расходы</Text>
        <Text style={s.toggle}>Свернуть</Text>
      </Pressable>
      <Text style={s.hint}>
        Эти траты не входят в факт бюджета. Возврат снова учитывает сумму — история чека при этом не менялась.
      </Text>

      {loading ? <ActivityIndicator /> : null}
      {!loading && items && !items.length ? (
        <Text style={s.empty}>Ничего не снято с учёта.</Text>
      ) : null}

      {(items || []).map((expense) => (
        <View key={expense.id} style={s.row}>
          <View style={s.rowText}>
            <Text style={s.rowTitle}>{expense.title}</Text>
            <Text style={s.rowMeta}>
              {formatRub(expense.amount)}
              {expense.expense_date ? ` · ${expense.expense_date.slice(0, 10)}` : ''}
            </Text>
          </View>
          <PrimaryButton
            title={busyId === expense.id ? 'Возврат…' : 'Вернуть'}
            variant="outline"
            compact
            disabled={Boolean(busyId)}
            onPress={() => { void restore(expense); }}
          />
        </View>
      ))}

      <PrimaryButton title="Обновить список" variant="ghost" compact onPress={() => { void load(); }} disabled={loading} />
    </View>
  );
}

const s = StyleSheet.create({
  box: {
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    borderRadius: RenovaTheme.radius.lg,
    padding: RenovaTheme.spacing.md,
    marginTop: RenovaTheme.spacing.sm,
    gap: RenovaTheme.spacing.sm,
    backgroundColor: RenovaTheme.colors.surface,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: RenovaTheme.minTouch,
  },
  head: { fontSize: RenovaTheme.fontSize.h3, fontWeight: '700', color: RenovaTheme.colors.text },
  toggle: { fontSize: RenovaTheme.fontSize.bodySmall, color: RenovaTheme.colors.accent, fontWeight: '600' },
  hint: { fontSize: RenovaTheme.fontSize.bodySmall, color: RenovaTheme.colors.textMuted },
  empty: { fontSize: RenovaTheme.fontSize.bodySmall, color: RenovaTheme.colors.textMuted },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: RenovaTheme.spacing.sm,
    minHeight: RenovaTheme.minTouch,
  },
  rowText: { flex: 1 },
  rowTitle: { fontSize: RenovaTheme.fontSize.body, fontWeight: '600', color: RenovaTheme.colors.text },
  rowMeta: { fontSize: RenovaTheme.fontSize.caption, color: RenovaTheme.colors.textMuted },
});
