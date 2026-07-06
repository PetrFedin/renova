import { reconcileBudgetFact, BUDGET_FACT_FORMULA_HINT } from './budgetFactReconcile';

const ok = reconcileBudgetFact(1000, 1000);
if (!ok.aligned || ok.delta !== 0) throw new Error('exact match');

const near = reconcileBudgetFact(1000, 1000.5);
if (!near.aligned) throw new Error('within tolerance');

const bad = reconcileBudgetFact(1000, 1100);
if (bad.aligned || bad.delta !== 100) throw new Error('mismatch');

if (!BUDGET_FACT_FORMULA_HINT.includes('budget_spent')) throw new Error('formula hint');

console.log('budgetFactReconcile.test OK');
