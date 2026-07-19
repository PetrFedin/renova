/** Вкладка «Бюджет → Расходы» — единый список трат + группировка по комнатам/этапам */
import { useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import { usePathname, router } from 'expo-router';
import { BudgetPeriodPicker } from '@/components/renova/BudgetPeriodPicker';
import { parseBudgetPeriod, BUDGET_PERIOD_LABEL } from '@/constants/budgetPeriod';
import { filterRowsByPeriod, sumRows } from '@/lib/domain/aggregateBudgetByPeriod';
import { formatRub } from '@/constants/Theme';
import { ManualExpenseForm } from '@/components/renova/ManualExpenseForm';
import { ReceiptBulkLinkPanel } from '@/components/renova/ReceiptBulkLinkPanel';
import { ReceiptBulkCategoryPanel } from '@/components/renova/ReceiptBulkCategoryPanel';
import { UnifiedExpenseList } from '@/components/renova/UnifiedExpenseList';
import { ScheduleFilterChips } from '@/components/renova/schedule/ScheduleFilterChips';
import { ExpenseByRoom } from '@/components/renova/ExpenseByRoom';
import { ExpenseByStage } from '@/components/renova/ExpenseByStage';
import type { MaterialPick, OsExpense, ProjectDetail, Purchase, ReceiptItem } from '@/lib/api';
import { buildUnifiedBudgetExpenses } from '@/lib/domain/buildUnifiedBudgetExpenses';
import { openExpenseRowTarget } from '@/lib/expenseRowNav';
import {
  EXPENSE_FILTER_LABELS,
  expenseFilterCounts,
  filterExpenseRows,
  receiptIdsFromRows,
  type ExpenseListFilter,
} from '@/lib/domain/filterExpenseRows';
import type { ExpenseDetailTarget } from '@/components/renova/ExpenseDetailSheet';
import { BudgetFactStatus } from '@/components/renova/budget/BudgetFactStatus';
import type { OsRole } from '@/constants/osSections';
import { budgetTabHref } from '@/constants/osSections';
import type { ExpenseView } from '@/constants/budgetTabs';
import { budgetScreenStyles as s } from '@/components/screens/budget/budgetScreenStyles';

type Props = {
  userId: string;
  project: ProjectDetail;
  receipts: ReceiptItem[];
  expenses: OsExpense[];
  picks: MaterialPick[];
  purchases?: Purchase[];
  role: OsRole;
  canWrite: boolean;
  readOnly: boolean;
  initialRoomId?: string | null;
  initialStageId?: string | null;
  periodParam?: string | string[];
  serverFact?: number;
  listTotal?: number;
  expenseView?: ExpenseView;
  onReload: () => void;
  onExpensePress: (target: ExpenseDetailTarget) => void;
};

const FILTER_KEYS: ExpenseListFilter[] = ['all', 'no-stage', 'unverified'];

const VIEW_ITEMS: { key: ExpenseView; label: string }[] = [
  { key: 'list', label: 'Список' },
  { key: 'rooms', label: 'По комнатам' },
  { key: 'stages', label: 'По этапам' },
];

export function BudgetExpensesSection({
  userId, project, receipts, expenses, picks, purchases = [], role, canWrite, readOnly, initialRoomId, initialStageId, periodParam, serverFact, listTotal, expenseView = 'list', onReload, onExpensePress,
}: Props) {
  const pathname = usePathname();
  const [filter, setFilter] = useState<ExpenseListFilter>('all');
  const period = parseBudgetPeriod(periodParam);
  const rows = buildUnifiedBudgetExpenses(receipts, expenses, project.rooms || [], project.stages || [], picks, purchases);
  const unifiedTotal = listTotal ?? rows.reduce((a, r) => a + r.amount, 0);
  const periodRows = useMemo(() => filterRowsByPeriod(rows, period), [rows, period]);
  const counts = useMemo(() => expenseFilterCounts(periodRows), [periodRows]);
  const filtered = useMemo(() => filterExpenseRows(periodRows, filter), [periodRows, filter]);
  const filteredReceiptIds = useMemo(() => receiptIdsFromRows(filtered), [filtered]);

  const filterItems = FILTER_KEYS.map((key) => ({
    key,
    label: counts[key] > 0 && key !== 'all' ? `${EXPENSE_FILTER_LABELS[key]} (${counts[key]})` : EXPENSE_FILTER_LABELS[key],
  }));
  const bulkCategoryHint =
    filter === 'all' && (counts['no-stage'] > 0 || counts['unverified'] > 0)
      ? counts['no-stage'] > 0 && counts['unverified'] > 0
        ? 'Массовая категория чеков: выберите фильтр «Без этапа» или «Не проверен» — панель появится ниже.'
        : counts['no-stage'] > 0
          ? 'Массовая категория чеков: выберите фильтр «Без этапа» — панель появится ниже.'
          : 'Массовая категория чеков: выберите фильтр «Не проверен» — панель появится ниже.'
      : null;

  return (
    <>
      <BudgetPeriodPicker period={period} tab="expenses" />
      <Text style={s.section}>Группировка</Text>
      <ScheduleFilterChips
        items={VIEW_ITEMS}
        value={expenseView}
        onChange={(key) => router.setParams({ tab: 'expenses', view: key })}
      />
      {expenseView === 'rooms' && (
        <>
          <Text style={s.section}>По комнатам</Text>
          <ExpenseByRoom
            rooms={project.rooms || []}
            lines={project.estimate_lines || []}
            receipts={receipts}
            expenses={expenses}
            picks={picks}
            purchases={purchases}
            stages={project.stages || []}
            returnTo={budgetTabHref(role, 'expenses', { view: 'rooms' })}
          />
        </>
      )}
      {expenseView === 'stages' && (
        <>
          <Text style={s.section}>По этапам</Text>
          <ExpenseByStage
            stages={project.stages || []}
            lines={project.estimate_lines || []}
            receipts={receipts}
            expenses={expenses}
            picks={picks}
            purchases={purchases}
            rooms={project.rooms || []}
            returnTo={budgetTabHref(role, 'expenses', { view: 'stages' })}
          />
        </>
      )}
      {expenseView === 'list' && (
        <>
      {typeof serverFact === 'number' && (
        <BudgetFactStatus serverFact={serverFact} listTotal={unifiedTotal} compact showAligned />
      )}
      <View style={{ marginBottom: 8 }}>
        <Text style={s.dataHint}>
          {BUDGET_PERIOD_LABEL[period]}: {formatRub(sumRows(periodRows))} · {periodRows.length} операций
        </Text>
        <Text style={s.dataHint}>
          Чеки — вы; закупки «Куплено» — подрядчик. Убрать материал из факта — «Убрать из факта» в закупке.
        </Text>
      </View>
      {canWrite && !readOnly && (
        <ReceiptBulkLinkPanel
          userId={userId}
          project={project}
          receipts={receipts}
          onDone={onReload}
        />
      )}
      {rows.length > 0 && (
        <Text style={s.section}>Фильтр трат</Text>
      )}
      {periodRows.length > 0 && (
        <ScheduleFilterChips items={filterItems} value={filter} onChange={(key) => setFilter(key as ExpenseListFilter)} />
      )}
      {canWrite && !readOnly && bulkCategoryHint && (
        <Text style={s.bulkHint}>{bulkCategoryHint}</Text>
      )}
      {canWrite && !readOnly && filter !== 'all' && filteredReceiptIds.length > 0 && (
        <ReceiptBulkCategoryPanel
          userId={userId}
          projectId={project.id}
          receiptIds={filteredReceiptIds}
          filterLabel={EXPENSE_FILTER_LABELS[filter]}
          onDone={onReload}
        />
      )}
      <UnifiedExpenseList
        rows={filtered}
        onPress={(row) => openExpenseRowTarget(row, receipts, expenses, picks, { returnTo: pathname, onDetail: onExpensePress })}
      />
      {!filtered.length && (
        <Text style={s.empty}>
          {filter === 'all'
            ? 'Нет трат. Используйте «+» для скана чека, добавьте вручную ниже или оформите закупку в «Материалы».'
            : filter === 'no-stage'
              ? 'Все траты привязаны к этапам.'
              : 'Нет чеков без проверки ФНС.'}
        </Text>
      )}
      {canWrite && !readOnly && (
        <ManualExpenseForm
          userId={userId}
          project={project}
          initialRoomId={initialRoomId ?? null}
          initialStageId={initialStageId ?? null}
          onSaved={onReload}
        />
      )}
        </>
      )}
    </>
  );
}
