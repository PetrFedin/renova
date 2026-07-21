/** Панель аналитики проекта: бюджет, статьи, этажи, таблица */
import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { RenovaTheme, card, formatRub } from '@/constants/Theme';
import { useRenova } from '@/lib/context/RenovaContext';
import { api, isRateLimitError, type MaterialPick, type OsExpense, type Purchase, type ReceiptItem } from '@/lib/api';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { BudgetFactStatus } from '@/components/renova/budget/BudgetFactStatus';
import { ExpenseByCategory } from '@/components/renova/ExpenseByCategory';
import { ExpenseByFloor } from '@/components/renova/ExpenseByFloor';
import { ExpenseDetailTable } from '@/components/renova/ExpenseDetailTable';
import { ExpenseDetailSheet, type ExpenseDetailTarget } from '@/components/renova/ExpenseDetailSheet';
import { OsWidgetGrid, type OsWidget } from '@/components/renova/os/OsWidgetStrip';
import { KPITrends } from '@/components/renova/KPITrends';
import { BudgetScenario } from '@/components/renova/BudgetScenario';
import { BudgetBreakdown } from '@/components/renova/BudgetBreakdown';
import { ProjectSitesPanel } from '@/components/renova/ProjectSitesPanel';
import { openExpenseRowTarget } from '@/lib/expenseRowNav';
import { resolveBudgetFigures } from '@/lib/useOsBudgetFigures';
import { useWriteAllowed } from '@/components/renova/ReadOnlyGuard';
import { ProjectEmptyState } from '@/components/renova/ProjectEmptyState';
import type { ExpenseDetailRow } from '@/lib/domain/expenseAnalytics';
import { buildUnifiedBudgetExpenses, unifiedExpenseTotal } from '@/lib/domain/buildUnifiedBudgetExpenses';
import { budgetTabHref } from '@/constants/osSections';
import { reportCatch, reportError } from '@/lib/reportError';

function budgetAnalyticsReturnTo(role: 'customer' | 'contractor') {
  return budgetTabHref(role, 'deviations');
}

export function ProjectAnalyticsPanel({ full }: { full?: boolean }) {
  const { user, activeProject, readOnly } = useRenova();
  const canWrite = useWriteAllowed();
  const [picks, setPicks] = useState<MaterialPick[]>([]);
  const [expenses, setExpenses] = useState<OsExpense[]>([]);
  const [receipts, setReceipts] = useState<ReceiptItem[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [apiSummary, setApiSummary] = useState<{ receipts_total: number; expenses_total?: number } | null>(null);
  const [osBudget, setOsBudget] = useState<import('@/lib/api').OsBudgetSummary | null>(null);
  const [kpiPoints, setKpiPoints] = useState<{ id: string; label: string; margin: number }[]>([]);
  const [expenseDetail, setExpenseDetail] = useState<ExpenseDetailTarget | null>(null);

  const onExpenseRowPress = useCallback((row: ExpenseDetailRow) => {
    openExpenseRowTarget(row, receipts, expenses, picks, {
      returnTo: budgetAnalyticsReturnTo(user?.role === 'contractor' ? 'contractor' : 'customer'),
      onDetail: setExpenseDetail,
      role: user?.role === 'contractor' ? 'contractor' : 'customer',
    });
  }, [receipts, expenses, picks, user?.role]);

  /** Не вызываем loadProject — дублировал getProject и ловил rate_limit storm */
  const reload = useCallback(async () => {
    if (!user || !activeProject) return;
    setLoading(true);
    try {
      setLoadError(false);
      const [rc, ex, pk, pur, sm, ob, kh] = await Promise.all([
        api.listReceipts(user.id, activeProject.id),
        api.osExpenses(user.id, activeProject.id),
        api.listMaterialPicks(user.id, activeProject.id),
        api.listPurchases(user.id, activeProject.id),
        api.expensesSummary(user.id, activeProject.id),
        api.osBudget(user.id, activeProject.id),
        api.kpiHistory(user.id, activeProject.id),
      ]);
      setReceipts(rc);
      setExpenses(ex);
      setPicks(pk);
      setPurchases(pur);
      setApiSummary(sm);
      setOsBudget(ob);
      setKpiPoints((kh as { margin: number; at: string }[]).slice(-6).map((p) => ({
        id: p.at,
        label: p.at.slice(5, 10),
        margin: p.margin,
      })));
    } catch (e) {
      if (isRateLimitError(e)) return;
      setLoadError(true);
      if (__DEV__) console.warn('[ProjectAnalyticsPanel]', e);
    } finally {
      setLoading(false);
    }
  }, [user?.id, activeProject?.id]);

  useFocusEffect(useCallback(() => { reload().catch(reportCatch('analytics.reload')); }, [reload]));
  useProjectDataReload(reload);

  if (!user || !activeProject) {
    const role = user?.role === 'contractor' ? 'contractor' : 'customer';
    return <ProjectEmptyState role={role} />;
  }
  if (loadError && !loading) {
    return (
      <Text style={{ padding: 12, color: RenovaTheme.colors.textMuted, fontSize: 13 }}>
        Аналитика не загрузилась — цифры скрыты, чтобы не показывать ложный ноль. Обновите экран.
      </Text>
    );
  }

  if (loading) {
    return <ActivityIndicator color={RenovaTheme.colors.primary} style={{ marginVertical: 16 }} />;
  }

  const rooms = activeProject.rooms || [];
  const stages = activeProject.stages || [];
  const lines = activeProject.estimate_lines || [];
  const receiptTotal = apiSummary?.receipts_total ?? receipts.reduce((a, r) => a + r.amount, 0);
  const unifiedRows = buildUnifiedBudgetExpenses(receipts, expenses, rooms, stages, picks, purchases);
  const listTotal = unifiedExpenseTotal(unifiedRows);

  const planFact = resolveBudgetFigures(activeProject, osBudget);
  const plan = planFact.planned;
  /** Единый факт — как на «Бюджет → Сводка» */
  const fact = osBudget?.budget_spent ?? apiSummary?.expenses_total ?? planFact.spent;

  const kpiWidgets: OsWidget[] = [
    { id: 'plan', label: 'План', value: formatRub(plan), width: 96 },
    { id: 'fact', label: 'Факт', value: formatRub(fact), hint: `${Math.round((fact / Math.max(1, plan)) * 100)}%`, width: 96 },
    { id: 'rc', label: 'Чеки', value: formatRub(receiptTotal), hint: `${receipts.length} шт · часть факта`, width: 110 },
    { id: 'list', label: 'Список', value: formatRub(listTotal), hint: 'без дублей', width: 104 },
  ];

  return (
    <>
    <View style={s.wrap}>
      <Text style={s.hint}>
        Факт = «Бюджет → Сводка». Закупки материалов — только статус «куплено». Оплаты подрядчикам — вкладка «Оплаты».
      </Text>
      <BudgetFactStatus serverFact={fact} listTotal={listTotal} compact showAligned />
      <OsWidgetGrid items={kpiWidgets} title="Сводка по проекту" />
      <KPITrends points={kpiPoints} />
      {full && user && activeProject && (
        <BudgetScenario userId={user.id} projectId={activeProject.id} />
      )}
      <ProjectSitesPanel project={activeProject} receipts={receipts} picks={picks} compact={!full} role={user.role === 'contractor' ? 'contractor' : 'customer'} />
      <BudgetBreakdown userId={user.id} projectId={activeProject.id} />
      <View style={s.row2}>
        <View style={s.half}>
          <ExpenseByCategory rows={unifiedRows} />
        </View>
      </View>
      <ExpenseByFloor rows={unifiedRows} rooms={rooms} lines={lines} propertyType={activeProject.property_type} />
      <ExpenseDetailTable
        receipts={receipts}
        expenses={expenses}
        picks={picks}
        purchases={purchases}
        rooms={rooms}
        stages={stages}
        compact={!full}
        role={user.role === 'contractor' ? 'contractor' : 'customer'}
        onRowPress={onExpenseRowPress}
      />
    </View>
    <ExpenseDetailSheet
      target={expenseDetail}
      project={activeProject ? { rooms, stages } : undefined}
      rooms={rooms}
      stages={stages}
      userId={user?.id}
      projectId={activeProject?.id}
      editable={canWrite && !readOnly}
      onClose={() => setExpenseDetail(null)}
      onChanged={() => { reload().catch(reportCatch('analytics.reload')); }}
    />
    </>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 4 },
  hint: { fontSize: 12, color: RenovaTheme.colors.textMuted, lineHeight: 17, marginBottom: 8 },
  muted: { color: RenovaTheme.colors.textMuted, padding: 16 },
  row2: { flexDirection: 'row', gap: 8 },
  half: { flex: 1 },
});
