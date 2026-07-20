/** Вкладка «Бюджет → Сводка» — KPI, alerts, сегменты, превью */
import { View, Text, Pressable } from 'react-native';
import { router, usePathname } from 'expo-router';
import { formatRub, RenovaTheme } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { BudgetFactStatus } from '@/components/renova/budget/BudgetFactStatus';
import { StageExpenseLinksPanel } from '@/components/renova/StageExpenseLinksPanel';
import { BudgetAlerts, type BudgetAlert } from '@/components/renova/BudgetAlerts';
import { RepairControlSummary } from '@/components/renova/RepairControlSummary';
import { OsWidgetGrid, type OsWidget } from '@/components/renova/os/OsWidgetStrip';
import { BUDGET_SEGMENT_LABEL, PAYMENT_TYPE_LABEL } from '@/constants/labels';
import type { ExpenseDetailTarget } from '@/components/renova/ExpenseDetailSheet';
import { api, MaterialPick, OsBudgetSummary, OsExpense, Payment, Purchase, ReceiptItem, Room, Stage } from '@/lib/api';
import { buildUnifiedBudgetExpenses, rowToExpenseTarget } from '@/lib/domain/buildUnifiedBudgetExpenses';
import { openExpenseRowTarget } from '@/lib/expenseRowNav';
import { formatForecastOverLabel } from '@/lib/domain/formatBudgetHint';
import { budgetScreenStyles as s } from '@/components/screens/budget/budgetScreenStyles';
import { BudgetPeriodDetailSection } from '@/components/screens/budget/BudgetPeriodDetailSection';
import { parseBudgetFocus, parseBudgetPeriod } from '@/constants/budgetPeriod';
import type { ExpenseDetailRow } from '@/lib/domain/expenseAnalytics';
import type { OsRole } from '@/constants/osSections';
import { budgetTabRoute } from '@/constants/osSections';
type Props = {
  userId: string;
  projectId: string;
  summary: OsBudgetSummary | null;
  summaryWidgets: OsWidget[];
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
    userId, projectId, summary, summaryWidgets, figures, riskColor, receipts, payments,
    budgetAlerts, expenses, pendingPayments, purchases = [], stages = [], rooms = [], picks = [], bwVisible, role, readOnly, customerBudget,
    projectStart, projectEnd, periodParam, focusParam, onPaymentPress, onExpensePress,
  } = props;
  const pathname = usePathname();
  const unifiedRows = buildUnifiedBudgetExpenses(receipts, expenses, rooms, stages, picks, purchases);
  const period = parseBudgetPeriod(periodParam);
  const focus = parseBudgetFocus(focusParam);

  const showRepairControl = bwVisible('repair_control');

  const onRowPress = (row: ExpenseDetailRow) => {
    openExpenseRowTarget(row, receipts, expenses, picks, { returnTo: pathname, onDetail: onExpensePress });
  };

  return (
    <>
      {customerBudget ? (
        <View style={s.limitCard}>
          <Text style={s.limitTitle}>Лимит заказчика</Text>
          <Text style={s.limitVal}>{formatRub(customerBudget)}</Text>
          <Text style={s.dataHint}>
            Смета {formatRub(figures.planned)} · факт {formatRub(figures.spent)}
            {figures.spent > customerBudget ? ` · перерасход ${formatRub(figures.spent - customerBudget)}` : ''}
          </Text>
        </View>
      ) : (
        <View style={s.limitCard}>
          <Text style={s.limitTitle}>Лимит не задан</Text>
          <Text style={s.dataHint}>
            План {formatRub(figures.planned)} — из сметы объекта. Факт {formatRub(figures.spent)} — учтённые траты. Задайте лимит в «Объект → Данные объекта».
          </Text>
        </View>
      )}

      {bwVisible('summary_kpi') && (
        <>
          <OsWidgetGrid items={summaryWidgets} title="Сводка" returnTo={pathname} />
          <BudgetFactStatus
            serverFact={summary?.budget_spent ?? figures.spent}
            listTotal={unifiedRows.reduce((a, r) => a + r.amount, 0)}
            compact
            showAligned
          />
          <Text style={s.dataHint}>
            Нажмите плитку — детализация по периоду. Комнаты, этапы и аналитика — вкладки выше. Счета подрядчикам — «Оплаты», не путать с фактом.
            {!showRepairControl
              ? ` План ${formatRub(summary?.budget_planned ?? figures.planned)} · факт ${formatRub(summary?.budget_spent ?? figures.spent)}.`
              : ''}
          </Text>
          {summary && (() => {
            const label = formatForecastOverLabel(summary.forecast_over, summary.budget_planned || figures.planned);
            return label ? <Text style={[s.risk, { color: riskColor }]}>{label}</Text> : null;
          })()}
        </>
      )}

      {focus && bwVisible('summary_kpi') ? (
        <BudgetPeriodDetailSection
          role={role}
          period={period}
          focus={focus}
          planned={summary?.budget_planned ?? figures.planned}
          spentTotal={summary?.budget_spent ?? figures.spent}
          forecastTotal={summary?.forecast_total}
          customerLimit={customerBudget}
          rows={unifiedRows}
          projectStart={projectStart}
          projectEnd={projectEnd}
          returnTo={pathname}
          onExpensePress={onRowPress}
        />
      ) : null}

      {bwVisible('repair_control') && (
        <>
          <StageExpenseLinksPanel
            rows={unifiedRows}
            stages={stages}
            rooms={rooms}
            picks={picks}
            returnTo={pathname}
          />
          <RepairControlSummary
            budgetPlanned={customerBudget ?? summary?.budget_planned ?? figures.planned}
            budgetSpent={summary?.budget_spent ?? figures.spent}
            receipts={receipts}
            payments={payments}
            listTotal={unifiedRows.reduce((a, r) => a + r.amount, 0)}
          />
        </>
      )}
      {bwVisible('budget_alerts') && <BudgetAlerts items={budgetAlerts} />}
      {bwVisible('actions') && (
        <View style={s.actions}>
          <PrimaryButton title="Таблица" variant="outline" compact onPress={() => api.exportExpensesCsv(userId, projectId)} />
          {role === 'contractor' ? (
            <PrimaryButton title="Рыночная оценка" variant="outline" compact onPress={() => router.push({ pathname: '/budget-planner', params: { returnTo: pathname } } as any)} />
          ) : null}
        </View>
      )}
      {summary && bwVisible('segments') && Object.keys(summary.segments || {}).length > 0 && (
        <>
          <Text style={s.section}>По статьям</Text>
          <OsWidgetGrid
            returnTo={pathname}
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
          {pendingPayments.map((p) => (
            <Pressable key={p.id} style={s.row} onPress={() => onPaymentPress(p)}>
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle}>{p.title}</Text>
                <Text style={s.rowMeta}>{PAYMENT_TYPE_LABEL[p.payment_type] || p.payment_type} · {formatRub(p.amount)}</Text>
              </View>
              {role === 'customer' && !readOnly ? (
                <PrimaryButton title="Оплатить →" compact onPress={() => onPaymentPress(p)} />
              ) : (
                <Text style={[s.status, { color: RenovaTheme.colors.warning }]}>Ожидает</Text>
              )}
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
