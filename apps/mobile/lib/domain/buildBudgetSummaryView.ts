export type BudgetSummaryState = 'empty' | 'no-fact' | 'over' | 'forecast-risk' | 'on-track';

export type BudgetSummaryViewInput = {
  planned: number;
  spent: number;
  deviation?: number | null;
  deviationPct?: number | null;
  forecast?: number | null;
  remaining?: number | null;
  customerBudget?: number | null;
  pendingAmounts?: number[];
};

export type BudgetSummaryView = {
  planned: number;
  spent: number;
  deviation: number;
  deviationPct: number;
  forecast: number | null;
  remaining: number;
  pendingAmount: number;
  pendingCount: number;
  /** Legacy field: plan headroom, NOT the contractor's commercial margin. */
  margin: number;
  customerBudget: number | null;
  customerBudgetOver: number;
  state: BudgetSummaryState;
  factKnown: boolean;
  /** These validity flags must gate all financial claims in the UI. */
  figuresValid: boolean;
  pendingValid: boolean;
  issues: string[];
  /** Local comparison only; NOT customer authorization or payment reconciliation. */
  reconciliation: 'consistent' | 'mismatch' | 'unavailable';
};

/** A strictly positive known actual can be compared with a valid plan. */
export function shouldShowSavings(planned: number, spent: number): boolean {
  return toKopecks(planned) !== null && toKopecks(spent) !== null && planned > 0 && spent > 0;
}

/** Exact UI money arithmetic in safe integer kopecks; no silent rounding. */
function toKopecks(value: unknown, allowNegative = false): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || (!allowNegative && value < 0)) return null;
  const kopecks = value * 100;
  const rounded = Math.round(kopecks);
  // Allow only floating-point representation error, never an extra fractional kopeck.
  return Number.isSafeInteger(rounded) && Math.abs(kopecks - rounded) <= 0.000001 ? rounded : null;
}

/**
 * Decision model: the ledger remains authoritative. Local arithmetic only
 * checks its published derivatives and exposes disagreement instead of
 * treating a missing/invalid money value as an authentic zero.
 */
export function buildBudgetSummaryView(input: BudgetSummaryViewInput): BudgetSummaryView {
  const issues: string[] = [];
  const plannedKopecks = toKopecks(input.planned);
  const spentKopecks = toKopecks(input.spent);
  if (plannedKopecks === null) issues.push('planned_invalid');
  if (spentKopecks === null) issues.push('spent_invalid');
  const figuresValid = plannedKopecks !== null && spentKopecks !== null;
  const plan = plannedKopecks ?? 0;
  const fact = spentKopecks ?? 0;
  const deviationKopecks = fact - plan;
  const remainingKopecks = Math.max(0, plan - fact);
  const deviationPct = plan > 0 ? Math.round((deviationKopecks / plan) * 1000) / 10 : 0;

  const compareMoney = (name: string, amount: number | null | undefined, expected: number, signed = false) => {
    if (amount == null) return;
    const value = toKopecks(amount, signed);
    if (value === null) issues.push(name + '_invalid');
    else if (figuresValid && value !== expected) issues.push(name + '_mismatch');
  };
  compareMoney('deviation', input.deviation, deviationKopecks, true);
  compareMoney('remaining', input.remaining, remainingKopecks);
  if (input.deviationPct != null) {
    if (!Number.isFinite(input.deviationPct)) issues.push('deviation_pct_invalid');
    else if (figuresValid && Math.abs(input.deviationPct - deviationPct) > 0.051) {
      issues.push('deviation_pct_mismatch');
    }
  }

  let forecast: number | null = null;
  if (input.forecast != null) {
    const value = toKopecks(input.forecast);
    if (value === null) issues.push('forecast_invalid');
    else if (spentKopecks !== null && value < spentKopecks) issues.push('forecast_below_actual');
    else forecast = value / 100;
  }

  let pendingKopecks = 0;
  let pendingCount = 0;
  let pendingValid = true;
  for (const pending of input.pendingAmounts ?? []) {
    const value = toKopecks(pending);
    if (value === null || value <= 0 || !Number.isSafeInteger(pendingKopecks + value)) {
      pendingValid = false;
      continue;
    }
    pendingKopecks += value;
    pendingCount++;
  }
  if (!pendingValid) issues.push('pending_invalid');

  let customerBudget: number | null = null;
  let customerBudgetOver = 0;
  if (input.customerBudget != null && input.customerBudget !== 0) {
    const limit = toKopecks(input.customerBudget);
    if (limit === null) issues.push('customer_budget_invalid');
    else {
      customerBudget = limit / 100;
      if (spentKopecks !== null) customerBudgetOver = Math.max(0, fact - limit) / 100;
    }
  }

  let state: BudgetSummaryState = 'on-track';
  if (!figuresValid || (plan === 0 && fact === 0)) state = 'empty';
  else if (fact === 0) state = 'no-fact';
  else if (deviationKopecks > 0) state = 'over';
  else if (forecast != null && forecast > plan / 100) state = 'forecast-risk';

  return {
    planned: plan / 100,
    spent: fact / 100,
    deviation: deviationKopecks / 100,
    deviationPct,
    forecast,
    remaining: remainingKopecks / 100,
    pendingAmount: pendingValid ? pendingKopecks / 100 : 0,
    pendingCount,
    margin: (plan - fact) / 100,
    customerBudget,
    customerBudgetOver,
    state,
    factKnown: figuresValid && fact > 0,
    figuresValid,
    pendingValid,
    issues,
    reconciliation: !figuresValid ? 'unavailable' : issues.length > 0 ? 'mismatch' : 'consistent',
  };
}
