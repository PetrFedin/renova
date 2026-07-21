/** Единый «Бюджет» — оркестратор вкладок (данные в useOsBudgetScreen) */
import { useEffect, useState } from 'react';
import { ScrollView } from 'react-native';
import { useLocalSearchParams, usePathname } from 'expo-router';
import { RenovaTheme } from '@/constants/Theme';
import { useRenova } from '@/lib/context/RenovaContext';
import { ReadOnlyBanner, useWriteAllowed } from '@/components/renova/ReadOnlyGuard';
import { ExpenseDetailSheet, type ExpenseDetailTarget } from '@/components/renova/ExpenseDetailSheet';
import { PaymentDetailSheet } from '@/components/renova/PaymentDetailSheet';
import { OsWidgetGrid, type OsWidget } from '@/components/renova/os/OsWidgetStrip';
import { useBudgetWidgets } from '@/lib/useBudgetWidgets';
import { useCustomerBudget } from '@/lib/hooks/useCustomerBudget';
import { ProjectEmptyState } from '@/components/renova/ProjectEmptyState';
import { useOsBudgetScreen } from '@/lib/hooks/useOsBudgetScreen';
import { budgetTabRoute, type OsRole } from '@/constants/osSections';
import { resolveBudgetFigures } from '@/lib/useOsBudgetFigures';
import type { Payment } from '@/lib/api';
import { BudgetSummarySection } from '@/components/screens/budget/BudgetSummarySection';
import { BudgetExpensesSection } from '@/components/screens/budget/BudgetExpensesSection';
import { BudgetPaymentsSection } from '@/components/screens/budget/BudgetPaymentsSection';
import { BudgetDeviationsSection } from '@/components/screens/budget/BudgetDeviationsSection';
import { buildUnifiedBudgetExpenses, unifiedExpenseTotal } from '@/lib/domain/buildUnifiedBudgetExpenses';
import { budgetScreenStyles as s } from '@/components/screens/budget/budgetScreenStyles';
import { formatRub } from '@/constants/Theme';
import type { BudgetTab, ExpenseView } from '@/constants/budgetTabs';
import { normalizeBudgetTab } from '@/constants/budgetTabs';

export type { BudgetTab } from '@/constants/budgetTabs';

export function OsBudgetScreen({ role, tab = 'summary' }: { role: OsRole; tab?: BudgetTab }) {
  const {
    roomId: roomParam,
    stageId: stageParam,
    period: periodParam,
    focus: focusParam,
    view: viewParam,
    tab: tabParam,
    openPayment: openPaymentParam,
    paymentId: paymentIdParam,
  } = useLocalSearchParams<{
    roomId?: string;
    stageId?: string;
    period?: string;
    focus?: string;
    view?: ExpenseView;
    tab?: string;
    openPayment?: string;
    paymentId?: string;
  }>();
  const pathname = usePathname();
  const canWrite = useWriteAllowed();
  const { readOnly } = useRenova();
  const { isVisible: bwVisible } = useBudgetWidgets(role);
  const [detailTarget, setDetailTarget] = useState<ExpenseDetailTarget | null>(null);
  const [paymentDetail, setPaymentDetail] = useState<Payment | null>(null);

  const {
    user, activeProject, summary, expenses, payments, receipts, purchases, picks, budgetAlerts,
    payFilter, setPayFilter, pending, filteredPayments, reload,
  } = useOsBudgetScreen();

  const { customerBudget } = useCustomerBudget({
    projectId: activeProject?.id,
    userId: user?.id,
    serverBudget: activeProject?.customer_budget,
  });

  if (!activeProject || !user) {
    return <ProjectEmptyState role={role} />;
  }

  const resolvedTab = normalizeBudgetTab(tabParam ?? tab).tab;
  const expenseView: ExpenseView =
    viewParam
    ?? (roomParam ? 'list' : undefined)
    ?? normalizeBudgetTab(tabParam).view
    ?? 'list';

  const figures = resolveBudgetFigures(activeProject, summary);
  const unifiedRows = buildUnifiedBudgetExpenses(
    receipts,
    expenses,
    activeProject.rooms || [],
    activeProject.stages || [],
    picks,
    purchases,
  );
  const listTotal = unifiedExpenseTotal(unifiedRows);
  const serverFact = summary?.budget_spent ?? figures.spent;
  const riskColor = summary?.risk === 'high' ? RenovaTheme.colors.danger : summary?.risk === 'medium' ? RenovaTheme.colors.warning : RenovaTheme.colors.success;
  const period = (periodParam as string) || 'month';

  useEffect(() => {
    if (paymentDetail) return;
    const wantOpen = openPaymentParam === '1' || openPaymentParam === 'true' || Boolean(paymentIdParam);
    if (!wantOpen) return;
    if (resolvedTab !== 'payments' && resolvedTab !== 'summary') return;
    const pendingList = payments.filter((x) => x.status === 'pending');
    const target =
      (paymentIdParam && payments.find((x) => x.id === paymentIdParam))
      || pendingList[0]
      || null;
    if (target) setPaymentDetail(target);
  }, [openPaymentParam, paymentIdParam, payments, resolvedTab, paymentDetail]);

  const summaryWidgets: OsWidget[] = [
    {
      id: 'plan',
      label: 'План',
      value: formatRub(summary?.budget_planned ?? figures.planned),
      width: 96,
      href: budgetTabRoute(role, 'summary', { period, focus: 'plan' }),
    },
    {
      id: 'fact',
      label: 'Факт',
      value: formatRub(summary?.budget_spent ?? figures.spent),
      width: 96,
      href: budgetTabRoute(role, 'summary', { period, focus: 'fact' }),
    },
    ...(summary
      ? [
          {
            id: 'forecast',
            label: 'Прогноз',
            value: formatRub(summary.forecast_total),
            width: 96,
            href: budgetTabRoute(role, 'summary', { period, focus: 'forecast' }),
          },
          {
            id: 'left',
            label: 'Остаток',
            value: formatRub(summary.remaining),
            hint: summary.forecast_over > 0 ? `+${formatRub(summary.forecast_over)} риск` : undefined,
            width: 104,
            accent: summary.remaining > 0 ? RenovaTheme.colors.success : RenovaTheme.colors.danger,
            href: budgetTabRoute(role, 'summary', { period, focus: 'left' }),
          },
        ]
      : []),
  ];

  return (
    <>
      <ScrollView style={s.wrap} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <ReadOnlyBanner />
        {resolvedTab === 'summary' && (
          <BudgetSummarySection
            userId={user.id}
            projectId={activeProject.id}
            summary={summary}
            summaryWidgets={summaryWidgets}
            figures={figures}
            riskColor={riskColor}
            receipts={receipts}
            payments={payments}
            budgetAlerts={budgetAlerts}
            expenses={expenses}
            pendingPayments={pending}
            purchases={purchases}
            stages={activeProject.stages || []}
            rooms={activeProject.rooms || []}
            picks={picks}
            bwVisible={bwVisible}
            role={role}
            readOnly={!!readOnly}
            customerBudget={customerBudget}
            projectStart={activeProject.planned_start_date}
            projectEnd={activeProject.planned_end_date}
            periodParam={periodParam}
            focusParam={focusParam}
            onPaymentPress={setPaymentDetail}
            onExpensePress={setDetailTarget}
          />
        )}
        {resolvedTab === 'expenses' && (
          <BudgetExpensesSection
            userId={user.id}
            project={activeProject}
            receipts={receipts}
            expenses={expenses}
            picks={picks}
            purchases={purchases}
            role={role}
            canWrite={canWrite}
            readOnly={!!readOnly}
            initialRoomId={roomParam ?? null}
            initialStageId={stageParam ?? null}
            periodParam={periodParam}
            serverFact={serverFact}
            listTotal={listTotal}
            expenseView={expenseView}
            onReload={reload}
            onExpensePress={setDetailTarget}
          />
        )}
        {resolvedTab === 'payments' && (
          <BudgetPaymentsSection
            role={role}
            userId={user.id}
            project={activeProject}
            readOnly={!!readOnly}
            canWrite={canWrite}
            payFilter={payFilter}
            setPayFilter={setPayFilter}
            filteredPayments={filteredPayments}
            onPaymentPress={setPaymentDetail}
            onSaved={reload}
          />
        )}
        {resolvedTab === 'deviations' && (
          <BudgetDeviationsSection role={role} alerts={budgetAlerts} returnTo={pathname} />
        )}
      </ScrollView>
      <ExpenseDetailSheet
        target={detailTarget}
        project={activeProject}
        rooms={activeProject.rooms || []}
        stages={activeProject.stages || []}
        userId={user.id}
        projectId={activeProject.id}
        editable={canWrite && !readOnly}
        onClose={() => setDetailTarget(null)}
        onChanged={reload}
      />
      <PaymentDetailSheet
        payment={paymentDetail}
        stages={activeProject.stages || []}
        role={role}
        readOnly={readOnly}
        userId={user.id}
        projectId={activeProject.id}
        onClose={() => setPaymentDetail(null)}
        onChanged={reload}
      />
    </>
  );
}
