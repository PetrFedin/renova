import { aggregatePortfolioBudgetBreakdowns } from './aggregatePortfolioBudget';
import type { BudgetBreakdown, OsExpense } from '@/lib/api';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function breakdown(overrides: Partial<BudgetBreakdown> = {}): BudgetBreakdown {
  return {
    works: 1000,
    materials_plan: 2000,
    materials_fact: 999999, // legacy field must not be trusted for portfolio fact
    waste: 300,
    reserve: 700,
    total_planned: 4000,
    budget_planned: 4000,
    budget_spent: 450,
    ...overrides,
  };
}

function expense(id: string, category: string, amount: number, status = 'confirmed'): OsExpense {
  return { id, title: id, category, amount, status };
}

const rows = aggregatePortfolioBudgetBreakdowns([
  {
    breakdown: breakdown(),
    expenses: [
      expense('labor', 'labor', 100),
      expense('material', 'materials', 200),
      expense('delivery', 'delivery', 50),
      expense('pending', 'materials', 999, 'pending_receipt'),
    ],
  },
]);

const works = rows.find((row) => row.key === 'works');
const materials = rows.find((row) => row.key === 'materials');
const waste = rows.find((row) => row.key === 'waste');
const reserve = rows.find((row) => row.key === 'reserve');
const other = rows.find((row) => row.key === 'other-fact');
const reconciliation = rows.find((row) => row.key === 'reconciliation');
const total = rows.find((row) => row.key === 'total');

assert(works?.planned === 1000 && works.spent === 100, 'works fact must come from confirmed labor ledger');
assert(materials?.planned === 2000 && materials.spent === 200, 'materials fact must come from Expense ledger, not legacy materials_fact');
assert(waste?.spent === null && waste.variance === null, 'waste fact unavailable must stay null');
assert(reserve?.spent === null && reserve.variance === null, 'reserve fact unavailable must stay null');
assert(other?.planned === null && other.spent === 50, 'unmatched confirmed categories remain explicit actual-only fact');
assert(reconciliation?.spent === 100, 'budget_spent vs categorized ledger gap must be surfaced, not hidden');
assert(total?.planned === 4000 && total.spent === 450, 'portfolio total must preserve backend financial truth');

// Known empty ledger means actual zero; it is different from unavailable data.
const zeroRows = aggregatePortfolioBudgetBreakdowns([
  { breakdown: breakdown({ budget_spent: 0 }), expenses: [] },
]);
const zeroWorks = zeroRows.find((row) => row.key === 'works');
assert(zeroWorks?.spent === 0 && zeroWorks.factState === 'known', 'known zero fact must remain zero');
assert(zeroWorks.variance === -1000, 'known zero fact may produce a real negative variance');

// Missing ledger must never be converted to fact=plan or fact=0.
const unavailableRows = aggregatePortfolioBudgetBreakdowns([
  { breakdown: breakdown({ budget_spent: 0 }), expenses: null },
]);
const unavailableWorks = unavailableRows.find((row) => row.key === 'works');
const unavailableMaterials = unavailableRows.find((row) => row.key === 'materials');
assert(unavailableWorks?.spent === null && unavailableWorks.variance === null, 'missing works fact stays unavailable');
assert(unavailableMaterials?.spent === null && unavailableMaterials.variance === null, 'missing materials fact stays unavailable');

console.log('aggregatePortfolioBudget.test OK');
