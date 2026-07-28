/** Вкладка «Бюджет → Расходы» — единый список трат + группировка по комнатам/этапам */
import { useMemo, useState } from 'react';
import { Text } from 'react-native';
import { usePathname, router } from 'expo-router';
import { BudgetPeriodPicker } from '@/components/renova/BudgetPeriodPicker';
import { parseBudgetPeriod, BUDGET_PERIOD_LABEL } from '@/constants/budgetPeriod';
import { filterRowsByPeriod, sumRows } from '@/lib/domain/aggregateBudgetByPeriod';
import { formatRub } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
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

function emptyLabel(filter: ExpenseListFilter): string {
  if (filter === 'no-stage') return 'Все траты привязаны к этапам.';
  if (filter === 'unverified') return 'Нет чеков без проверки ФНС.';
  return 'Трат за выбранный период пока нет.';
}

export function BudgetExpensesSection({
  userId, project, receipts, expenses, picks, purchases = [], role, canWrite, readOnly, initialRoomId, initialStageId, periodParam, serverFact, listTotal, expenseView = 'list', onReload, onExpensePress,
}: Props) {
  const pathname = usePathname();
  const [filter, setFilter] = useState<ExpenseListFilter>('all');
  const period = parseBudgetPeriod(periodParam);
  const rows = buildUnifiedBudgetExpenses(receipts, expenses, project.rooms || [], project.stages || [], picks, purchases);
  const unifiedTotal = listTotal ?? rows.reduce((sum, row) => sum + row.amount, 0);
  const periodRows = useMemo(() => filterRowsByPeriod(rows, period), [rows, period]);
  const counts = useMemo(() => expenseFilterCounts(periodRows), [periodRows]);
  const filtered = useMemo(() => filterExpenseRows(periodRows, filter), [periodRows, filter]);
  const filteredReceiptIds = useMemo(() => receiptIdsFromRows(filtered), [filtered]);
  const canOperate = canWrite && !readOnly;

  const filterItems = FILTER_KEYS.map((key) => ({
    key,
    label: counts[key] > 0 && key !== 'all'
      ? `${EXPENSE_FILTER_LABELS[key]} (${counts[key]})`
      : EXPENSE_FILTER_LABELS[key],
  }));

  return (
    <>
      <BudgetPeriodPicker period={period} tab="expenses" />
      <Text style={s.section}>Вид расходов</Text>
      <ScheduleFilterChips
        items={VIEW_ITEMS}
        value={expenseView}
        onChange={(key) => router.setParams({ tab: 'expenses', view: key })}
      />

      {expenseView === 'rooms' ? (
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
      ) : null}

      {expenseView === 'stages' ? (
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
      ) : null}

      {expenseView === 'list' ? (
        <>
          {typeof serverFact === 'number' ? (
            <BudgetFactStatus serverFact={serverFact} listTotal={unifiedTotal} compact showAligned />
          ) : null}
          <Text style={s.dataHint}>
            {BUDGET_PERIOD_LABEL[period]} · {formatRub(sumRows(periodRows))} · {periodRows.length} операций
          </Text>

          {periodRows.length > 0 ? (
            <ScheduleFilterChips
              items={filterItems}
              value={filter}
              onChange={(key) => setFilter(key as ExpenseListFilter)}
            />
          ) : null}

          <UnifiedExpenseList
            rows={filtered}
            onPress={(row) => openExpenseRowTarget(
              row,
              receipts,
              expenses,
              picks,
              { returnTo: pathname, onDetail: onExpensePress, role },
            )}
          />

          {!filtered.length ? (
            <>
              <Text style={s.empty}>{emptyLabel(filter)}</Text>
              {filter !== 'all' ? (
                <PrimaryButton title="Показать все траты" variant="ghost" onPress={() => setFilter('all')} />
              ) : null}
            </>
          ) : null}

          {canOperate && filter === 'no-stage' ? (
            <ReceiptBulkLinkPanel
              userId={userId}
              project={project}
              receipts={receipts}
              onDone={onReload}
            />
          ) : null}

          {canOperate && filter !== 'all' && filteredReceiptIds.length > 0 ? (
            <ReceiptBulkCategoryPanel
              userId={userId}
              projectId={project.id}
              receiptIds={filteredReceiptIds}
              filterLabel={EXPENSE_FILTER_LABELS[filter]}
              onDone={onReload}
            />
          ) : null}

          {canOperate ? (
            <ManualExpenseForm
              userId={userId}
              project={project}
              initialRoomId={initialRoomId ?? null}
              initialStageId={initialStageId ?? null}
              onSaved={onReload}
              collapsed
            />
          ) : null}
        </>
      ) : null}
    </>
  );
}
