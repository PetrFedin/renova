import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { RenovaTheme, card, formatRub } from '@/constants/Theme';
import { api } from '@/lib/api';
import type { OsBudgetSummary, OsExpense, Payment } from '@/lib/api/types';
import { useRenova } from '@/lib/context/RenovaContext';

type FinanceState = {
  budget: OsBudgetSummary | null;
  expenses: OsExpense[];
  payments: Payment[];
};

function paymentLabel(status: string) {
  switch (status) {
    case 'pending': return 'Ждёт оплаты';
    case 'confirmed': return 'Оплачен';
    case 'cancelled': return 'Отменён';
    default: return status;
  }
}

function moneyTone(value: number) {
  if (value > 0) return RenovaTheme.colors.dangerText;
  if (value < 0) return RenovaTheme.colors.successText;
  return RenovaTheme.colors.text;
}

function MetricCard({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: string }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, tone ? { color: tone } : null]} numberOfLines={1}>{value}</Text>
      <Text style={styles.metricHint} numberOfLines={2}>{hint}</Text>
    </View>
  );
}

export function FinanceCenterScreen() {
  const { user, activeProject } = useRenova();
  const [state, setState] = useState<FinanceState>({ budget: null, expenses: [], payments: [] });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user || !activeProject) return;
    try {
      const [budget, expenses, payments] = await Promise.all([
        api.osBudget(user.id, activeProject.id).catch(() => null),
        api.osExpenses(user.id, activeProject.id).catch(() => []),
        api.listPayments(user.id, activeProject.id).catch(() => []),
      ]);
      setState({ budget, expenses, payments });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user, activeProject]);

  useEffect(() => { load(); }, [load]);

  const pendingPayments = useMemo(() => state.payments.filter((p) => p.status === 'pending'), [state.payments]);
  const confirmedPayments = useMemo(() => state.payments.filter((p) => p.status === 'confirmed'), [state.payments]);
  const pendingAmount = useMemo(() => pendingPayments.reduce((sum, p) => sum + (p.amount || 0), 0), [pendingPayments]);
  const confirmedAmount = useMemo(() => confirmedPayments.reduce((sum, p) => sum + (p.amount || 0), 0), [confirmedPayments]);
  const topExpenses = useMemo(() => [...state.expenses].sort((a, b) => b.amount - a.amount).slice(0, 5), [state.expenses]);
  const budget = state.budget;

  const confirmPayment = async (payment: Payment) => {
    if (!user || !activeProject) return;
    setConfirmingId(payment.id);
    try {
      await api.confirmPayment(user.id, activeProject.id, payment.id);
      await load();
    } catch {
      await load();
    } finally {
      setConfirmingId(null);
    }
  };

  if (!user || !activeProject) {
    return (
      <View style={styles.center}>
        <Text style={styles.stateTitle}>Нет активного проекта</Text>
        <Text style={styles.stateText}>Выберите проект, чтобы открыть финансовый центр.</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={RenovaTheme.colors.primaryMuted} />
        <Text style={styles.stateText}>Собираем финансы проекта...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
    >
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Text style={styles.back}>‹ Назад</Text></Pressable>
        <Text style={styles.title}>Финансовый центр</Text>
        <Text style={styles.subtitle}>{activeProject.name}</Text>
      </View>

      <View style={styles.heroCard}>
        <Text style={styles.heroLabel}>Финансовый статус</Text>
        <Text style={[styles.heroTitle, { color: moneyTone(budget?.forecast_over || 0) }]}>
          {budget && (budget.forecast_over || 0) > 0 ? `Риск перерасхода ${formatRub(budget.forecast_over)}` : 'Критичного перерасхода нет'}
        </Text>
        <Text style={styles.heroText}>
          {budget ? `План ${formatRub(budget.budget_planned)} · факт ${formatRub(budget.budget_spent)} · прогноз ${formatRub(budget.forecast_total)}` : 'Нет данных бюджета.'}
        </Text>
      </View>

      <View style={styles.metricGrid}>
        <MetricCard
          label="Факт"
          value={budget ? formatRub(budget.budget_spent) : '—'}
          hint={budget ? `Остаток: ${formatRub(budget.remaining)}` : 'Нет бюджета'}
        />
        <MetricCard
          label="Отклонение"
          value={budget ? formatRub(budget.deviation) : '—'}
          hint={budget ? `${Math.round(budget.deviation_pct || 0)}% от плана` : 'Нет расчёта'}
          tone={moneyTone(budget?.deviation || 0)}
        />
        <MetricCard
          label="К оплате"
          value={formatRub(pendingAmount)}
          hint={`${pendingPayments.length} платежей ожидают действия`}
        />
        <MetricCard
          label="Оплачено"
          value={formatRub(confirmedAmount)}
          hint={`${confirmedPayments.length} подтверждённых платежей`}
        />
      </View>

      <View style={styles.cardBlock}>
        <Text style={styles.sectionTitle}>Ожидают оплаты</Text>
        {pendingPayments.length ? pendingPayments.slice(0, 5).map((payment) => (
          <View key={payment.id} style={styles.row}>
            <View style={styles.rowMain}>
              <Text style={styles.rowTitle} numberOfLines={1}>{payment.title}</Text>
              <Text style={styles.rowMeta}>{paymentLabel(payment.status)} · {formatRub(payment.amount)}</Text>
            </View>
            <PrimaryButton
              title="Оплатить"
              compact
              onPress={() => confirmPayment(payment)}
              loading={confirmingId === payment.id}
              disabled={Boolean(confirmingId)}
            />
          </View>
        )) : <Text style={styles.emptyText}>Нет платежей, ожидающих оплаты.</Text>}
      </View>

      <View style={styles.cardBlock}>
        <Text style={styles.sectionTitle}>Крупные расходы</Text>
        {topExpenses.length ? topExpenses.map((expense) => (
          <View key={expense.id} style={styles.expenseRow}>
            <View style={styles.rowMain}>
              <Text style={styles.rowTitle} numberOfLines={1}>{expense.title}</Text>
              <Text style={styles.rowMeta}>{expense.category} · {expense.status}</Text>
            </View>
            <Text style={styles.amountText}>{formatRub(expense.amount)}</Text>
          </View>
        )) : <Text style={styles.emptyText}>Расходы пока не отражены.</Text>}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: RenovaTheme.colors.background },
  content: { padding: RenovaTheme.spacing.lg, paddingBottom: 32, gap: RenovaTheme.spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8, backgroundColor: RenovaTheme.colors.background },
  header: { gap: 4 },
  back: { fontSize: RenovaTheme.fontSize.body, color: RenovaTheme.colors.primaryMuted, fontWeight: RenovaTheme.fontWeight.semibold },
  title: { fontSize: RenovaTheme.fontSize.h1, fontWeight: RenovaTheme.fontWeight.bold, color: RenovaTheme.colors.text },
  subtitle: { fontSize: RenovaTheme.fontSize.body, color: RenovaTheme.colors.textMuted },
  heroCard: { ...card, gap: RenovaTheme.spacing.sm, borderLeftWidth: 4, borderLeftColor: RenovaTheme.colors.primaryMuted },
  heroLabel: { fontSize: RenovaTheme.fontSize.caption, color: RenovaTheme.colors.textMuted, fontWeight: RenovaTheme.fontWeight.bold, textTransform: 'uppercase', letterSpacing: 0.4 },
  heroTitle: { fontSize: RenovaTheme.fontSize.h2, fontWeight: RenovaTheme.fontWeight.extrabold, lineHeight: 26 },
  heroText: { fontSize: RenovaTheme.fontSize.bodySmall, color: RenovaTheme.colors.textMuted, lineHeight: 18 },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: RenovaTheme.spacing.sm },
  metricCard: { ...card, width: '48%', minHeight: 112, gap: 5 },
  metricLabel: { fontSize: RenovaTheme.fontSize.caption, color: RenovaTheme.colors.textMuted, fontWeight: RenovaTheme.fontWeight.bold },
  metricValue: { fontSize: RenovaTheme.fontSize.h3, color: RenovaTheme.colors.text, fontWeight: RenovaTheme.fontWeight.extrabold },
  metricHint: { fontSize: RenovaTheme.fontSize.caption, color: RenovaTheme.colors.textMuted, lineHeight: 16 },
  cardBlock: { ...card, gap: RenovaTheme.spacing.sm },
  sectionTitle: { fontSize: RenovaTheme.fontSize.h3, color: RenovaTheme.colors.text, fontWeight: RenovaTheme.fontWeight.bold },
  row: { flexDirection: 'row', alignItems: 'center', gap: RenovaTheme.spacing.sm, paddingVertical: 8, borderTopWidth: 1, borderTopColor: RenovaTheme.colors.border },
  expenseRow: { flexDirection: 'row', alignItems: 'center', gap: RenovaTheme.spacing.sm, paddingVertical: 8, borderTopWidth: 1, borderTopColor: RenovaTheme.colors.border },
  rowMain: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: RenovaTheme.fontSize.bodySmall, color: RenovaTheme.colors.text, fontWeight: RenovaTheme.fontWeight.extrabold },
  rowMeta: { marginTop: 2, fontSize: RenovaTheme.fontSize.caption, color: RenovaTheme.colors.textMuted },
  amountText: { fontSize: RenovaTheme.fontSize.bodySmall, color: RenovaTheme.colors.text, fontWeight: RenovaTheme.fontWeight.extrabold },
  emptyText: { fontSize: RenovaTheme.fontSize.bodySmall, color: RenovaTheme.colors.textMuted, lineHeight: 18 },
  stateTitle: { fontSize: RenovaTheme.fontSize.h3, fontWeight: RenovaTheme.fontWeight.bold, color: RenovaTheme.colors.text, textAlign: 'center' },
  stateText: { fontSize: RenovaTheme.fontSize.bodySmall, color: RenovaTheme.colors.textMuted, textAlign: 'center', lineHeight: 18 },
});
