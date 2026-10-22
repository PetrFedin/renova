import { buildBudgetSummaryView, shouldShowSavings } from './buildBudgetSummaryView';

const must = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

must(!shouldShowSavings(185938, 0), 'zero spent cannot certify savings');
must(shouldShowSavings(185938, 1), 'positive known actual supports comparison');
must(!shouldShowSavings(0, 100), 'missing plan does not mean savings');

const noFact = buildBudgetSummaryView({
  planned: 185938, spent: 0, deviation: -185938, deviationPct: -100,
});
must(noFact.state === 'no-fact' && !noFact.factKnown, 'no-fact state');
must(noFact.reconciliation === 'consistent', 'valid zero actual is not invalid');
must(noFact.margin === 185938, 'legacy headroom stays unchanged');

const normal = buildBudgetSummaryView({
  planned: 1000, spent: 700,
  deviation: -300, deviationPct: -30, remaining: 300,
  forecast: 900, pendingAmounts: [100.10, 200.20],
});
must(normal.state === 'on-track' && normal.pendingCount === 2, 'normal state');
must(normal.pendingAmount === 300.30, 'sum exact integer kopecks');
must(normal.reconciliation === 'consistent', 'consistent server derivatives');

const binary = buildBudgetSummaryView({
  planned: 1, spent: 0.1 + 0.2, pendingAmounts: [0.1 + 0.2],
});
must(binary.spent === 0.3 && binary.pendingAmount === 0.3, 'binary JS noise tolerated');

const above = buildBudgetSummaryView({ planned: 1000, spent: 1200, forecast: 1300 });
must(above.state === 'over' && above.deviation === 200 && above.remaining === 0, 'overspent project');

const forecastRisk = buildBudgetSummaryView({ planned: 1000, spent: 700, forecast: 1100 });
must(forecastRisk.state === 'forecast-risk', 'forecast risk only when valid');
const belowActual = buildBudgetSummaryView({ planned: 1000, spent: 700, forecast: 500 });
must(belowActual.forecast === null && belowActual.issues.includes('forecast_below_actual'), 'impossible forecast must be flagged');

const mismatched = buildBudgetSummaryView({
  planned: 1000, spent: 800, deviation: -300, deviationPct: -25, remaining: 400,
});
must(mismatched.deviation === -200 && mismatched.remaining === 200, 'derived truth uses canonical plan minus spent');
must(mismatched.issues.includes('deviation_mismatch'), 'bad server delta detectable');
must(mismatched.issues.includes('remaining_mismatch'), 'bad server remaining detectable');
must(mismatched.issues.includes('deviation_pct_mismatch'), 'bad server percent detectable');
must(mismatched.reconciliation === 'mismatch', 'mismatch never quietly on track');

const invalid = buildBudgetSummaryView({ planned: Number.NaN, spent: -5, pendingAmounts: [-1, Number.NaN] });
must(invalid.state === 'empty' && !invalid.figuresValid, 'malformed financial facts not valid');
must(invalid.reconciliation === 'unavailable', 'malformed money cannot claim reconciliation');
must(!invalid.pendingValid && invalid.pendingAmount === 0, 'invalid payables cannot become a harmless real zero');
must(invalid.issues.includes('planned_invalid') && invalid.issues.includes('pending_invalid'), 'reasons retained');

const fractional = buildBudgetSummaryView({ planned: 100, spent: 2.001, pendingAmounts: [0.001] });
must(!fractional.figuresValid && !fractional.pendingValid, 'no silent fractional-kopeck rounding');

const huge = buildBudgetSummaryView({ planned: Number.MAX_SAFE_INTEGER, spent: 5 });
must(!huge.figuresValid, 'unsafe integer kopeck sums rejected');

const negatives = buildBudgetSummaryView({ planned: 100, spent: 150, customerBudget: 120 });
must(negatives.customerBudgetOver === 30 && negatives.margin === -50, 'over budget and plan headroom');

const invalidLimit = buildBudgetSummaryView({ planned: 100, spent: 150, customerBudget: Number.NaN });
must(invalidLimit.customerBudget === null && invalidLimit.issues.includes('customer_budget_invalid'), 'invalid customer limit not treated as an approved limit');

const pending = buildBudgetSummaryView({ planned: 100, spent: 5, pendingAmounts: [1, -3, 4] });
must(pending.pendingCount === 2 && !pending.pendingValid && pending.reconciliation === 'mismatch', 'invalid pending payment is visible');

console.log('buildBudgetSummaryView.test OK');
