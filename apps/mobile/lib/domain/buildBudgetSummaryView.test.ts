import { buildBudgetSummaryView, shouldShowSavings } from './buildBudgetSummaryView';

{
  const must = (c: boolean, m: string) => { if (!c) throw new Error(m); };
  must(!shouldShowSavings(185938, 0), 'факт 0 — экономию не показываем');
  must(shouldShowSavings(185938, 1), 'факт > 0 — показываем');
  must(!shouldShowSavings(0, 100), 'плана нет — нечего сравнивать');
  const v = buildBudgetSummaryView({ planned: 185938, spent: 0, deviation: -185938, deviationPct: -100 });
  must(v.state === 'no-fact' && !v.factKnown, 'факт 0 → no-fact');
  must(buildBudgetSummaryView({ planned: 1000, spent: 700 }).factKnown, 'факт 700 известен');
  console.log('buildBudgetSummaryView.test OK');
}
