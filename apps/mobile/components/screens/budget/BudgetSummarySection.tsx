/** Вкладка «Бюджет → Сводка» — состояние, решение, затем детали */
import { View, Text, Pressable } from 'react-native';
import { router, usePathname } from 'expo-router';
import { formatRub, RenovaTheme } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { BudgetFactStatus } from '@/components/renova/budget/BudgetFactStatus';
import { StageExpenseLinksPanel } from '@/components/renova/StageExpenseLinksPanel';
import { BudgetAlerts, type BudgetAlert } from '@/components/renova/BudgetAlerts';
import { RepairControlSummary } from '@/components/renova/RepairControlSummary';
import { OsWidgetGrid } from '@/components/renova/os/OsWidgetStrip';
import { BUDGET_SEGMENT_LABEL, PAYMENT_TYPE_LABEL } from '@/constants/labels';
import type { ExpenseDetailTarget } from '@/components/renova/ExpenseDetailSheet';
import { api, MaterialPick, OsBudgetSummary, OsExpense, Payment, Purchase, ReceiptItem, Room, Stage } from '@/lib/api';
import { buildUnifiedBudgetExpenses, rowToExpenseTarget } from '@/lib/domain/buildUnifiedBudgetExpenses';
import { openExpenseRowTarget } from '@/lib/expenseRowNav';
import { formatForecastOverLabel } from '@/lib/domain/formatBudgetHint';
import { buildBudgetSummaryView } from '@/lib/domain/buildBudgetSummaryView';
import { budgetScreenStyles as s } from '@/components/screens/budget/budgetScreenStyles';
import { BudgetPeriodDetailSection } from '@/components/screens/budget/BudgetPeriodDetailSection';
import { parseBudgetFocus, parseBudgetPeriod } from '@/constants/budgetPeriod';
import type { ExpenseDetailRow } from '@/lib/domain/expenseAnalytics';
import { budgetTabRoute, objectTabRoute, type OsRole } from '@/constants/osSections';
import { pushOsNav } from '@/lib/pushOsNav';

type Props = {
  userId: string;
  projectId: string;
  summary: OsBudgetSummary | null;
  figures: { planned: number; spent: number };
  riskColor: string;
  receipts: ReceiptItem[];
  payments: Payment[];
  budgetAlerts: BudgetAlert[];
  expenses: OsExpense[];
  pendingPayments: Payment[];
  purchases?: Purchase[];
  stages?: Stage[];
  rooms?: Room[];
  picks?: MaterialPick[];
  bwVisible: (id: string) => boolean;
  role: OsRole;
  readOnly: boolean;
  customerBudget?: number | null;
  projectStart?: string | null;
  projectEnd?: string | null;
  periodParam?: string | string[];
  focusParam?: string | string[];
  onPaymentPress: (p: Payment) => void;
  onExpensePress: (target: ExpenseDetailTarget) => void;
};

export function BudgetSummarySection(props: Props) {
  const {
    userId, projectId, summary, figures, riskColor, receipts, payments,
    budgetAlerts, expenses, pendingPayments, purchases = [], stages = [], rooms = [], picks = [], bwVisible, role, readOnly, customerBudget,
    projectStart, projectEnd, periodParam, focusParam, onPaymentPress, onExpensePress,
  } = props;
  const pathname = usePathname();
  const unifiedRows = buildUnifiedBudgetExpenses(receipts, expenses, rooms, stages, picks, purchases);
  const period = parseBudgetPeriod(periodParam);
  const focus = parseBudgetFocus(focusParam);
  const showRepairControl = bwVisible('repair_control');
  const planned = summary?.budget_planned ?? figures.planned;
  const spent = summary?.budget_spent ?? figures.spent;
  const view = buildBudgetSummaryView({
    planned,
    spent,
    deviation: summary?.deviation,
    deviationPct: summary?.deviation_pct,
    forecast: summary?.forecast_total,
    remaining: summary?.remaining,
    customerBudget,
    pendingAmounts: pendingPayments.map((payment) => payment.amount),
  });

  const stateLabel = {
    empty: 'Нет финансовых данных',
    over: 'Перерасход',
    'forecast-risk': 'Риск превышения',
    'on-track': 'В пределах плана',
  }[view.state];
  const stateColor = view.state === 'over'
    ? RenovaTheme.colors.danger
    : view.state === 'forecast-risk'
      ? RenovaTheme.colors.warning
      : view.state === 'empty'
        ? RenovaTheme.colors.textMuted
        : RenovaTheme.colors.success;
  const deviationLabel = view.deviation > 0 ? 'Перерасход' : view.deviation < 0 ? 'Экономия' : 'Отклонение';
  const deviationValue = view.deviation > 0
    ? `+${formatRub(view.deviation)}`
    : view.deviation < 0
      ? `−${formatRub(Math.abs(view.deviation))}`
      : formatRub(0);

  const firstPending = pendingPayments[0] ?? null;
  const urgentBudget = view.state === 'over' || view.state === 'forecast-risk' || budgetAlerts.length > 0;
  const nextAction = firstPending && role === 'customer' && !readOnly
    ? {
        title: `Оплатить ${formatRub(firstPending.amount)}`,
        primary: true,
        onPress: () => onPaymentPress(firstPending),
      }
    : view.pendingCount > 0
      ? {
          title: `Открыть оплаты (${view.pendingCount})`,
          primary: true,
          onPress: () => router.setParams({ tab: 'payments' }),
        }
      : urgentBudget
        ? {
            title: 'Разобрать отклонения',
            primary: true,
            onPress: () => router.setParams({ tab: 'deviations' }),
          }
        : {
            title: 'Открыть расходы',
            primary: false,
            onPress: () => router.setParams({ tab: 'expenses' }),
          };

  const onRowPress = (row: ExpenseDetailRow) => {
    openExpenseRowTarget(row, receipts, expenses, picks, { returnTo: pathname, onDetail: onExpensePress, role });
  };

  return (
    <>
      {bwVisible('summary_kpi') && (
        <View style={s.summaryHero}>
          <View style={s.summaryHeader}>
            <Text style={s.summaryTitle}>Состояние бюджета</Text>
            <Text style={[s.summaryState, { color: stateColor }]}>{stateLabel}</Text>
          </View>

          <View style={s.summaryMainRow}>
            <View style={s.summaryMainCell}>
              <Text style={s.summaryLabel}>Факт</Text>
              <Text style={s.summaryValue}>{formatRub(view.spent)}</Text>
            </View>
            <View style={s.summaryMainCell}>
              <Text style={s.summaryLabel}>{deviationLabel}</Text>
              <Text style={[s.summaryValue, { color: view.deviation > 0 ? RenovaTheme.colors.danger : RenovaTheme.colors.text }]}>
                {deviationValue}
              </Text>
            </View>
          </View>

          <Text style={s.dataHint}>
            План {formatRub(view.planned)}
            {view.deviationPct !== 0 ? ` · отклонение ${view.deviationPct > 0 ? '+' : ''}${view.deviationPct}%` : ''}
            {role === 'contractor' ? ` · маржа ${formatRub(view.margin)}` : ''}
          </Text>
          <Text style={[s.dataHint, view.customerBudgetOver > 0 && { color: RenovaTheme.colors.dangerText }]}>
            {view.customerBudget != null
              ? `Лимит заказчика ${formatRub(view.customerBudget)}${view.customerBudgetOver > 0 ? ` · превышение ${formatRub(view.customerBudgetOver)}` : ''}`
              : 'Лимит заказчика не задан — план берётся из сметы объекта.'}
          </Text>

          <View style={s.summaryMetaRow}>
            {view.forecast != null ? (
              <View style={s.summaryMetaCell}>
                <Text style={s.summaryLabel}>Прогноз</Text>
                <Text style={s.summaryMetaValue}>{formatRub(view.forecast)}</Text>
              </View>
            ) : null}
            <View style={s.summaryMetaCell}>
              <Text style={s.summaryLabel}>Остаток</Text>
              <Text style={s.summaryMetaValue}>{formatRub(view.remaining)}</Text>
            </View>
            {view.pendingCount > 0 ? (
              <View style={s.summaryMetaCell}>
                <Text style={s.summaryLabel}>Ожидает оплаты</Text>
                <Text style={s.summaryMetaValue}>{formatRub(view.pendingAmount)}</Text>
              </View>
            ) : null}
          </View>

          <BudgetFactStatus
            serverFact={view.spent}
            listTotal={unifiedRows.reduce((sum, row) => sum + row.amount, 0)}
            compact
            showAligned
          />
          {summary && (() => {
            const label = formatForecastOverLabel(summary.forecast_over, view.planned);
            return label ? <Text style={[s.risk, { color: riskColor }]}>{label}</Text> : null;
          })()}
          <View style={s.summaryAction}>
            <PrimaryButton
              title={nextAction.title}
              variant={nextAction.primary ? 'primary' : 'outline'}
              fullWidth
              onPress={nextAction.onPress}
            />
          </View>
        </View>
      )}

      {focus && bwVisible('summary_kpi') ? (
        <BudgetPeriodDetailSection
          role={role}
          period={period}
          focus={focus}
          planned={view.planned}
          spentTotal={view.spent}
          forecastTotal={view.forecast ?? undefined}
          customerLimit={view.customerBudget}
          rows={unifiedRows}
          projectStart={projectStart}
          projectEnd={projectEnd}
          returnTo={pathname}
          onExpensePress={onRowPress}
        />
      ) : null}

      {(summary?.change_orders?.length ?? 0) > 0 ? (
        <>
          <Text style={s.section}>Доп. работы</Text>
          <Text style={s.changeOrderTotal}>{formatRub(summary?.change_orders_approved_sum ?? 0)}</Text>
          <Text style={s.dataHint}>Согласованные изменения уже включены в план бюджета.</Text>
          {(summary?.change_orders ?? []).slice(0, 4).map((co) => (
            <Pressable
              key={co.id}
              style={s.row}
              accessibilityRole="button"
              accessibilityLabel={`Открыть изменение сметы ${co.title}`}
              onPress={() => {
                const route = objectTabRoute(role, 'estimate');
                pushOsNav(
                  { pathname: route.pathname, params: { ...route.params, estimateLayer: 'changes' } },
                  pathname,
                  role,
                );
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle}>{co.title}</Text>
                <Text style={s.rowMeta}>{co.status === 'approved' ? 'Согласовано' : co.status === 'pending' ? 'На согласовании' : co.status}</Text>
              </View>
              <Text style={s.status}>{formatRub(co.amount)}</Text>
            </Pressable>
          ))}
        </>
      ) : null}

      {bwVisible('repair_control') && (
        <>
          <StageExpenseLinksPanel
            rows={unifiedRows}
            stages={stages}
            rooms={rooms}
            picks={picks}
            returnTo={pathname}
            role={role}
          />
          <RepairControlSummary
            budgetPlanned={view.customerBudget ?? view.planned}
            budgetSpent={view.spent}
            receipts={receipts}
            payments={payments}
            listTotal={unifiedRows.reduce((sum, row) => sum + row.amount, 0)}
          />
        </>
      )}
      {bwVisible('budget_alerts') && <BudgetAlerts items={budgetAlerts} returnTo={pathname} role={role} />}
      {bwVisible('actions') && (
        <View style={s.actions}>
          <PrimaryButton title="Таблица" variant="outline" compact onPress={() => api.exportExpensesCsv(userId, projectId)} />
          {role === 'contractor' ? (
            <PrimaryButton title="Рыночная оценка" variant="outline" compact onPress={() => pushOsNav('/budget-planner', pathname, role)} />
          ) : null}
        </View>
      )}
      {summary && bwVisible('segments') && Object.keys(summary.segments || {}).length > 0 && (
        <>
          <Text style={s.section}>По статьям</Text>
          <OsWidgetGrid
            returnTo={pathname}
            role={role}
            items={Object.entries(summary.segments).map(([k, v]) => ({
              id: k,
              label: BUDGET_SEGMENT_LABEL[k] || k,
              value: formatRub(v.planned),
              hint: `факт ${formatRub(v.actual)}`,
              href: budgetTabRoute(role, 'deviations', { period, focus: 'fact' }),
            }))}
          />
        </>
      )}
      {pendingPayments.length > 0 && bwVisible('pending_payments') && (
        <>
          <Text style={s.section}>Ожидает оплаты</Text>
          {pendingPayments.map((payment) => (
            <Pressable
              key={payment.id}
              style={s.row}
              accessibilityRole="button"
              accessibilityLabel={`Открыть оплату ${payment.title}`}
              onPress={() => onPaymentPress(payment)}
            >
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle}>{payment.title}</Text>
                <Text style={s.rowMeta}>{PAYMENT_TYPE_LABEL[payment.payment_type] || payment.payment_type} · {formatRub(payment.amount)}</Text>
              </View>
              <Text style={[s.status, { color: RenovaTheme.colors.warning }]}>
                {role === 'customer' && !readOnly ? 'Открыть →' : 'Ожидает'}
              </Text>
            </Pressable>
          ))}
        </>
      )}
      {unifiedRows.length > 0 && bwVisible('expense_preview') && (
        <>
          <Text style={s.section}>Последние траты</Text>
          {unifiedRows.slice(0, 5).map((row) => (
            <Pressable
              key={row.id}
              style={s.row}
              accessibilityRole="button"
              accessibilityLabel={`Открыть расход ${row.title}`}
              onPress={() => {
                const target = rowToExpenseTarget(row, receipts, expenses);
                if (target) onExpensePress(target);
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle}>{formatRub(row.amount)}</Text>
                <Text style={s.rowMeta}>{row.categoryLabel} · {row.title}</Text>
              </View>
              <Text style={s.status}>{row.kind === 'receipt' ? 'Чек' : 'Запись'}</Text>
            </Pressable>
          ))}
          <PrimaryButton title="Все расходы →" variant="outline" compact onPress={() => router.setParams({ tab: 'expenses' })} />
        </>
      )}
    </>
  );
}
