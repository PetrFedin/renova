/** Портфельный бюджет: план отдельно, подтверждённый факт только из Expense ledger. */
import type { BudgetBreakdown, OsExpense } from '@/lib/api';

export type PortfolioBudgetSource = {
  breakdown: BudgetBreakdown;
  /** Canonical confirmed expense ledger for the same project. null = unavailable. */
  expenses: OsExpense[] | null;
};

export type PortfolioCategoryRow = {
  key: string;
  label: string;
  planned: number | null;
  spent: number | null;
  variance: number | null;
  variancePct: number | null;
  hasOverrun: boolean;
  factState: 'known' | 'unavailable';
};

function money(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

function categoryLine(
  key: string,
  label: string,
  planned: number | null,
  spent: number | null,
): PortfolioCategoryRow {
  const normalizedPlan = planned == null ? null : money(planned);
  const normalizedSpent = spent == null ? null : money(spent);
  const variance =
    normalizedPlan == null || normalizedSpent == null
      ? null
      : money(normalizedSpent - normalizedPlan);
  const variancePct =
    variance == null || normalizedPlan == null || normalizedPlan <= 0
      ? null
      : Math.round((variance / normalizedPlan) * 100);
  return {
    key,
    label,
    planned: normalizedPlan,
    spent: normalizedSpent,
    variance,
    variancePct,
    hasOverrun: variance != null && normalizedPlan != null && normalizedPlan > 0 && variance > 0,
    factState: normalizedSpent == null ? 'unavailable' : 'known',
  };
}

function confirmed(expenses: OsExpense[]): OsExpense[] {
  return expenses.filter((expense) => expense.status === 'confirmed');
}

/**
 * Never infer category fact from category plan.
 *
 * Comparable ledger mapping:
 * - labor/works -> planned works;
 * - materials -> planned materials;
 * - delivery/tools/other and unknown categories -> separate actual-only row.
 *
 * Waste/reserve remain fact-unavailable because the current Expense taxonomy has
 * no independent canonical category for them. Total fact stays the backend
 * budget_spent truth; a reconciliation row surfaces any ledger/total mismatch.
 */
export function aggregatePortfolioBudgetBreakdowns(sources: PortfolioBudgetSource[]): PortfolioCategoryRow[] {
  let worksPlan = 0;
  let materialsPlan = 0;
  let wastePlan = 0;
  let reservePlan = 0;
  let totalPlan = 0;
  let totalSpent = 0;

  let worksFact = 0;
  let materialsFact = 0;
  let otherFact = 0;
  let factsAvailable = true;

  for (const source of sources) {
    const b = source.breakdown;
    worksPlan += b.works || 0;
    materialsPlan += b.materials_plan || 0;
    wastePlan += b.waste || 0;
    reservePlan += b.reserve || 0;
    totalPlan += b.budget_planned || 0;
    totalSpent += b.budget_spent || 0;

    if (source.expenses == null) {
      factsAvailable = false;
      continue;
    }

    for (const expense of confirmed(source.expenses)) {
      const amount = Number.isFinite(expense.amount) ? expense.amount : 0;
      if (expense.category === 'labor' || expense.category === 'works') {
        worksFact += amount;
      } else if (expense.category === 'materials') {
        materialsFact += amount;
      } else {
        otherFact += amount;
      }
    }
  }

  const knownWorksFact = factsAvailable ? money(worksFact) : null;
  const knownMaterialsFact = factsAvailable ? money(materialsFact) : null;
  const knownOtherFact = factsAvailable ? money(otherFact) : null;

  const lines: PortfolioCategoryRow[] = [
    categoryLine('works', 'Работы', worksPlan, knownWorksFact),
    categoryLine('materials', 'Материалы', materialsPlan, knownMaterialsFact),
    // There is currently no canonical Expense category that independently
    // proves these planned lines. Null is intentional; zero would be fiction.
    categoryLine('waste', 'Вывоз мусора', wastePlan, null),
    categoryLine('reserve', 'Резерв', reservePlan, null),
  ];

  if (knownOtherFact != null && knownOtherFact !== 0) {
    lines.push(categoryLine('other-fact', 'Прочие подтверждённые расходы', null, knownOtherFact));
  }

  if (factsAvailable) {
    const categorizedFact = money(worksFact + materialsFact + otherFact);
    const gap = money(totalSpent - categorizedFact);
    if (Math.abs(gap) >= 0.01) {
      lines.push(categoryLine('reconciliation', 'Нераспределённый факт · сверка', null, gap));
    }
  }

  lines.push(categoryLine('total', 'Итого по бюджету', totalPlan, totalSpent));

  return lines.filter((line) =>
    line.key === 'total' ||
    (line.planned != null && line.planned !== 0) ||
    (line.spent != null && line.spent !== 0),
  );
}
