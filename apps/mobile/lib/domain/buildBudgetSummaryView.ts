export type BudgetSummaryState = 'empty' | 'over' | 'forecast-risk' | 'on-track';

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
  margin: number;
  customerBudget: number | null;
  customerBudgetOver: number;
  state: BudgetSummaryState;
};

function finite(value: number | null | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Decision model for the Budget summary.
 * Server semantics are preserved: positive deviation means fact is above plan.
 */
export function buildBudgetSummaryView(input: BudgetSummaryViewInput): BudgetSummaryView {
  const planned = Math.max(0, finite(input.planned, 0));
  const spent = Math.max(0, finite(input.spent, 0));
  const deviation = finite(input.deviation, spent - planned);
  const deviationPct = finite(
    input.deviationPct,
    planned > 0 ? Math.round((deviation / planned) * 1000) / 10 : 0,
  );
  const forecastCandidate = input.forecast == null ? null : finite(input.forecast, planned);
  const forecast = forecastCandidate == null ? null : Math.max(0, forecastCandidate);
  const remaining = Math.max(0, finite(input.remaining, planned - spent));
  const pendingAmounts = (input.pendingAmounts ?? []).filter(
    (amount) => Number.isFinite(amount) && amount > 0,
  );
  const pendingAmount = Math.round(pendingAmounts.reduce((sum, amount) => sum + amount, 0) * 100) / 100;
  const customerBudget = input.customerBudget != null && Number.isFinite(input.customerBudget) && input.customerBudget > 0
    ? input.customerBudget
    : null;
  const customerBudgetOver = customerBudget == null ? 0 : Math.max(0, spent - customerBudget);

  let state: BudgetSummaryState = 'on-track';
  if (planned === 0 && spent === 0) state = 'empty';
  else if (deviation > 0) state = 'over';
  else if (forecast != null && forecast > planned) state = 'forecast-risk';

  return {
    planned,
    spent,
    deviation,
    deviationPct,
    forecast,
    remaining,
    pendingAmount,
    pendingCount: pendingAmounts.length,
    margin: planned - spent,
    customerBudget,
    customerBudgetOver,
    state,
  };
}
