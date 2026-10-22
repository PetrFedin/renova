/** Вкладка «Бюджет → Сводка» — состояние, решение, затем детали */
import { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { notifyError } from '@/lib/notify';
import { router, usePathname } from 'expo-router';
import { formatRub, RenovaTheme } from '@/constants/Theme';

import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { BudgetFactStatus } from '@/components/renova/budget/BudgetFactStatus';
import { StageExpenseLinksPanel } from '@/components/renova/StageExpenseLinksPanel';
import { BudgetAlerts, type BudgetAlert } from '@/components/renova/BudgetAlerts';
import { RepairControlSummary } from '@/components/renova/RepairControlSummary';
import { OsWidgetGrid } from '@/components/renova/os/OsWidgetStrip';
import { BUDGET_SEGMENT_LABEL, PAYMENT_TYPE_LABEL } from '@/constants/labels';
import type { BudgetWidgetId } from '@/constants/budgetWidgets';
import type { ExpenseDetailTarget } from '@/components/renova/ExpenseDetailSheet';
import { api, MaterialPick, OsBudgetSummary, OsExpense, Payment, Purchase, ReceiptItem, Room, Stage } from '@/lib/api';
import { buildUnifiedBudgetExpenses, rowToExpenseTarget } from '@/lib/domain/buildUnifiedBudgetExpenses';
import { openExpenseRowTarget } from '@/lib/expenseRowNav';
import { formatForecastOverLabel } from '@/lib/domain/formatBudgetHint';
import { buildBudgetSummaryView } from '@/lib/domain/buildBudgetSummaryView';
import { InfoBanner, StatusPill, type StatusTone } from '@/components/ui';
import { CustomerConsentCoveragePanel } from '@/components/renova/CustomerConsentCoveragePanel';
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
  bwVisible: (id: BudgetWidgetId) => boolean;
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
  const [exporting, setExporting] = useState(false);
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

  const stateLabel = !view.figuresValid
    ? 'Нет достоверных сумм'
    : view.reconciliation !== 'consistent'
      ? 'Требуется сверка'
      : {
          empty: 'Нет финансовых данных',
          'no-fact': 'Факт ещё не внесён',
          over: 'Перерасход',
          'forecast-risk': 'Риск превышения',
          'on-track': 'В пределах плана',
        }[view.state];
  const statusTone: StatusTone = !view.figuresValid
    ? 'danger'
    : view.reconciliation !== 'consistent' || view.state === 'forecast-risk'
      ? 'warning'
      : view.state === 'over'
        ? 'danger'
        : view.state === 'empty' || view.state === 'no-fact'
          ? 'neutral'
          : 'success';
  const rubExact = (amount: number) => new Intl.NumberFormat('ru-RU', {
    style: 'currency', currency: 'RUB', minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(amount);
  // Spending below the budget is NOT realized savings or contractor profit.
  // Until the customer accepts the final scope, it only means below-plan spend.
  const deviationLabel = !view.factKnown ? 'Отклонение'
    : view.deviation > 0 ? 'Перерасход' : view.deviation < 0 ? 'Ниже плана' : 'Отклонение';
  const deviationValue = view.factKnown ? rubExact(Math.abs(view.deviation)) : '—';

  // Pending requests are not proof of customer-authorized payable obligations.
  const unverifiedPayments = payments.filter((payment) => payment.status === 'paid_unverified');
  // тот же критерий, что рисует BudgetAlerts: иначе «Разобрать отклонения» ведёт на пустую вкладку
  const hasRoomOverrun = budgetAlerts.some((alert) => alert.plan > 0 && alert.fact > alert.plan);
  const urgentBudget = view.state === 'over' || view.state === 'forecast-risk' || hasRoomOverrun;
  const nextAction = view.reconciliation !== 'consistent'
    ? {
        title: 'Проверить расчёты и документы',
        primary: false,
        onPress: () => router.setParams({ tab: 'expenses' }),
      }
    : pendingPayments.length > 0
      ? {
          title: `Проверить счета (${pendingPayments.length})`,
          primary: false,
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
            <StatusPill tone={statusTone} label={stateLabel} />
          </View>

          <View style={s.summaryMainRow}>
            <View style={s.summaryMainCell}>
              <Text style={s.summaryLabel}>Факт</Text>
              <Text style={s.summaryValue}>{view.figuresValid ? rubExact(view.spent) : '—'}</Text>
            </View>
            <View style={s.summaryMainCell}>
              <Text style={s.summaryLabel}>{deviationLabel}</Text>
              <Text style={[s.summaryValue, { color: view.deviation > 0 ? RenovaTheme.colors.danger : RenovaTheme.colors.text }]}>
                {view.figuresValid ? deviationValue : '—'}
              </Text>
            </View>
          </View>

          <Text style={s.dataHint}>
            План {view.figuresValid ? rubExact(view.planned) : '—'}
            {view.factKnown && view.deviationPct !== 0 ? ` · отклонение ${view.deviationPct > 0 ? '+' : ''}${view.deviationPct}%` : ''}
            {role === 'contractor' && view.factKnown ? ` · остаток по плану ${rubExact(view.margin)}` : ''}
          </Text>
          <Text style={[s.dataHint, view.customerBudgetOver > 0 && { color: RenovaTheme.colors.dangerText }]}>
            {view.customerBudget != null
              ? `Лимит заказчика ${rubExact(view.customerBudget)}${view.figuresValid && view.customerBudgetOver > 0 ? ` · превышение ${rubExact(view.customerBudgetOver)}` : ''}`
              : 'Лимит заказчика не задан — план берётся из сметы объекта.'}
          </Text>

          <View style={s.summaryMetaRow}>
            {view.forecast != null && view.factKnown ? (
              <View style={s.summaryMetaCell}>
                <Text style={s.summaryLabel}>Прогноз</Text>
                <Text style={s.summaryMetaValue}>{rubExact(view.forecast)}</Text>
              </View>
            ) : null}
            <View style={s.summaryMetaCell}>
              <Text style={s.summaryLabel}>Остаток плана</Text>
              <Text style={s.summaryMetaValue}>{view.figuresValid ? rubExact(view.remaining) : '—'}</Text>
            </View>
            {pendingPayments.length > 0 ? (
              <View style={s.summaryMetaCell}>
                <Text style={s.summaryLabel}>Ожидает оплаты</Text>
                <Text style={s.summaryMetaValue}>{view.pendingValid ? rubExact(view.pendingAmount) : '—'}</Text>
              </View>
            ) : null}
          </View>
          {(summary?.paid_unverified_count ?? 0) > 0 ? (
            <Text style={s.dataHint}>
              Не в факте: {rubExact(summary?.paid_unverified_total ?? 0)} оплачено без проверки ({summary?.paid_unverified_count}) —
              нужен чек или подтверждение получения исполнителем.
            </Text>
          ) : null}

          {view.figuresValid ? (
            <BudgetFactStatus
              serverFact={view.spent}
              listTotal={unifiedRows.reduce((sum, row) => sum + row.amount, 0)}
              compact
              showAligned
            />
          ) : null}
          {view.reconciliation !== 'consistent' ? (
            <InfoBanner
              tone="warning"
              title="Нужна сверка финансовых данных"
              message={!view.figuresValid
                ? 'План или подтверждённый факт недоступен. Не принимайте решение об оплате по этой сводке.'
                : 'Данные расчёта противоречат опубликованным суммам или содержат некорректный платёж. Проверьте счета и первичные документы.'}
            />
          ) : null}
          {summary && view.figuresValid && (() => {
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

      {role === 'customer' ? (
        <CustomerConsentCoveragePanel userId={userId} projectId={projectId} />
      ) : null}

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
          <PrimaryButton
            title="Таблица"
            variant="outline"
            compact
            loading={exporting}
            disabled={exporting}
            onPress={() => {
              if (exporting) return;
              setExporting(true);
              api.exportExpensesCsv(userId, projectId)
                .catch((error: unknown) => {
                  notifyError('Таблица не выгружена', error, 'Не удалось сформировать таблицу расходов. Повторите попытку.');
                })
                .finally(() => setExporting(false));
            }}
          />
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
                {role === 'customer' && !readOnly ? 'Проверить' : 'Ожидает'}
              </Text>
            </Pressable>
          ))}
        </>
      )}
      {unverifiedPayments.length > 0 && bwVisible('pending_payments') && (
        <>
          <Text style={s.section}>Оплачено, на проверке</Text>
          <Text style={s.dataHint}>Эти суммы пока не в факте: нужен чек или подтверждение получения исполнителем.</Text>
          {unverifiedPayments.map((payment) => (
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
              <Text style={[s.status, { color: RenovaTheme.colors.warning }]}>На проверке</Text>
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
