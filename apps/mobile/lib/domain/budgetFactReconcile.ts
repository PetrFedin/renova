/** Как считается факт бюджета — контракт UI ↔ API. Подробнее: docs/BUDGET_FACT.md */
export const BUDGET_FACT_FORMULA_HINT =
  'Факт на сводке = budget_spent с сервера. Закупка попадает в факт на paid, а delivered добирает пропущенную оплату. Список расходов предпочитает Expense-строки и не дублирует их purchased-материалами той же закупки.';
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
