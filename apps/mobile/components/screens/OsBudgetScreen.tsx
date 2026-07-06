/** Единый «Бюджет» — оркестратор вкладок (данные в useOsBudgetScreen) */
import { useState } from 'react';
import { ScrollView, View, Text, Pressable, Alert } from 'react-native';
import { useLocalSearchParams, usePathname, router } from 'expo-router';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import { useRenova } from '@/lib/context/RenovaContext';
import { ReadOnlyBanner, useWriteAllowed } from '@/components/renova/ReadOnlyGuard';
import { ExpenseByRoom } from '@/components/renova/ExpenseByRoom';
import { ExpenseByStage } from '@/components/renova/ExpenseByStage';
import { ProjectAnalyticsPanel } from '@/components/renova/ProjectAnalyticsPanel';
import { ExpenseDetailSheet, type ExpenseDetailTarget } from '@/components/renova/ExpenseDetailSheet';
import { PaymentDetailSheet } from '@/components/renova/PaymentDetailSheet';
import { OsWidgetGrid, type OsWidget } from '@/components/renova/os/OsWidgetStrip';
import { useBudgetWidgets } from '@/lib/useBudgetWidgets';
import { useCustomerBudget } from '@/lib/hooks/useCustomerBudget';
import { ProjectEmptyState } from '@/components/renova/ProjectEmptyState';
import { useOsBudgetScreen } from '@/lib/hooks/useOsBudgetScreen';
import { budgetTabHref, budgetTabRoute, type OsRole } from '@/constants/osSections';
import { pushOsTabNav } from '@/lib/osTabNav';
import { resolveBudgetFigures } from '@/lib/useOsBudgetFigures';
import { api, Payment, ApiError } from '@/lib/api';
import { BudgetSummarySection } from '@/components/screens/budget/BudgetSummarySection';
import { BudgetExpensesSection } from '@/components/screens/budget/BudgetExpensesSection';
import { BudgetPaymentsSection } from '@/components/screens/budget/BudgetPaymentsSection';
import { buildUnifiedBudgetExpenses, unifiedExpenseTotal } from '@/lib/domain/buildUnifiedBudgetExpenses';
import { budgetScreenStyles as s } from '@/components/screens/budget/budgetScreenStyles';

export type BudgetTab = 'summary' | 'expenses' | 'payments' | 'rooms' | 'stages' | 'analytics';

export function OsBudgetScreen({ role, tab = 'summary' }: { role: OsRole; tab?: BudgetTab }) {
  const { roomId: roomParam, stageId: stageParam, period: periodParam, focus: focusParam } = useLocalSearchParams<{
    roomId?: string;
    stageId?: string;
    period?: string;
    focus?: string;
  }>();
  const pathname = usePathname();
  const canWrite = useWriteAllowed();
  const { readOnly } = useRenova();
  const { isVisible: bwVisible } = useBudgetWidgets(role);
  const [detailTarget, setDetailTarget] = useState<ExpenseDetailTarget | null>(null);
  const [paymentDetail, setPaymentDetail] = useState<Payment | null>(null);

  const {
    user, activeProject, summary, expenses, payments, receipts, picks, budgetAlerts,
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

  const figures = resolveBudgetFigures(activeProject, summary);
  const unifiedRows = buildUnifiedBudgetExpenses(
    receipts,
    expenses,
    activeProject.rooms || [],
    activeProject.stages || [],
    picks,
  );
  const listTotal = unifiedExpenseTotal(unifiedRows);
  const serverFact = summary?.budget_spent ?? figures.spent;
  const riskColor = summary?.risk === 'high' ? RenovaTheme.colors.danger : summary?.risk === 'medium' ? RenovaTheme.colors.warning : RenovaTheme.colors.success;
  const period = (periodParam as string) || 'month';

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

  const showSummary = tab === 'summary';
  const showExpenses = tab === 'expenses';
  const showPayments = tab === 'payments';

  return (
    <>
      <ScrollView style={s.wrap} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <ReadOnlyBanner />
        <Pressable
          style={s.widgetSettingsLink}
          onPress={() => pushOsTabNav(role, 'profile', undefined, undefined, pathname)}
          accessibilityRole="button"
        >
          <Text style={s.widgetSettingsText}>⚙ Настроить блоки бюджета</Text>
          <Text style={s.widgetSettingsArrow}>→</Text>
        </Pressable>
        {showSummary && (
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
            onConfirmPayment={async (id) => {
              try {
                await api.confirmPayment(user.id, activeProject.id, id);
                await reload();
              } catch (e) {
                const msg = e instanceof ApiError && e.status === 409
                  ? 'Сначала примите этап на вкладке «Контроль»'
                  : 'Не удалось подтвердить оплату';
                Alert.alert('Оплата', msg);
              }
            }}
            onExpensePress={setDetailTarget}
          />
        )}
        {showExpenses && (
          <BudgetExpensesSection
            userId={user.id}
            project={activeProject}
            receipts={receipts}
            expenses={expenses}
            picks={picks}
            role={role}
            canWrite={canWrite}
            readOnly={!!readOnly}
            initialRoomId={roomParam ?? null}
            initialStageId={stageParam ?? null}
            periodParam={periodParam}
            serverFact={serverFact}
            listTotal={listTotal}
            onReload={reload}
            onExpensePress={setDetailTarget}
          />
        )}
        {showPayments && (
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
        {tab === 'analytics' && <ProjectAnalyticsPanel full />}
        {tab === 'stages' && (
          <>
            <Text style={s.section}>По этапам и работам</Text>
            <ExpenseByStage
              stages={activeProject.stages || []}
              lines={activeProject.estimate_lines || []}
              receipts={receipts}
              expenses={expenses}
              picks={picks}
              rooms={activeProject.rooms || []}
              returnTo={budgetTabHref(role, 'stages')}
            />
          </>
        )}
        {tab === 'rooms' && (
          <>
            <Text style={s.section}>По комнатам</Text>
            <ExpenseByRoom
              rooms={activeProject.rooms || []}
              lines={activeProject.estimate_lines || []}
              receipts={receipts}
              expenses={expenses}
              picks={picks}
              stages={activeProject.stages || []}
              returnTo={budgetTabHref(role, 'rooms')}
            />
          </>
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
      <PaymentDetailSheet payment={paymentDetail} stages={activeProject.stages || []} role={role} readOnly={readOnly} userId={user.id} projectId={activeProject.id} onClose={() => setPaymentDetail(null)} onChanged={reload} />
    </>
  );
}
