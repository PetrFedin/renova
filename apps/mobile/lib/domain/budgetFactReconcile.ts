/** Как считается факт бюджета — контракт UI ↔ API. Подробнее: docs/BUDGET_FACT.md */
export const BUDGET_FACT_FORMULA_HINT =
  'Факт на сводке = budget_spent с сервера. Список расходов = чеки + os-записи + закупки «Куплено» без дублей. Согласованные материалы без покупки в факт не входят.';
export type BudgetFactReconcile = {
  serverFact: number;
  listTotal: number;
  delta: number;
  aligned: boolean;
};

/** Допуск 1 ₽ — округление и timing API */
export function reconcileBudgetFact(
  serverFact: number,
  listTotal: number,
  tolerance = 1,
): BudgetFactReconcile {
  const delta = listTotal - serverFact;
  return {
    serverFact,
    listTotal,
    delta,
    aligned: Math.abs(delta) <= tolerance,
  };
}
