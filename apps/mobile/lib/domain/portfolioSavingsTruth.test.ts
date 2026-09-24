/**
 * Unspent budget is not a saving.
 *
 * `savings` was `max(0, totalPlan - totalSpent)` across the whole portfolio, so
 * a project that simply had not started spending yet was reported as a saving
 * of its entire budget. Observed in the running app with three projects,
 * 254 868 ₽ planned, 0 ₽ spent, 0% work done:
 *
 *     Все проекты (3)
 *     План 254 868 ₽ · факт 0 ₽
 *     Экономия 254 868 ₽ (-100%)
 *
 * Nothing had been saved. The money is still going to be spent. Telling a
 * customer they saved 100% of a renovation that has not begun is the same
 * class of defect as #318 — a number presented as a measured fact when it is
 * not one.
 *
 * A saving only exists once the work is finished.
 */
import { summarizePortfolio } from './summarizePortfolio';

const must = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

type Row = Parameters<typeof summarizePortfolio>[0][number];

const project = (over: Partial<Row> & { id: string }): Row => ({
  name: over.id,
  budget_planned: 0,
  budget_spent: 0,
  progress_percent: 0,
  pending_payments: 0,
  ...over,
}) as Row;

// --- the reported defect -----------------------------------------------------

const untouched = summarizePortfolio([
  project({ id: 'a', budget_planned: 185938, budget_spent: 0 }),
  project({ id: 'b', budget_planned: 34465, budget_spent: 0 }),
  project({ id: 'c', budget_planned: 34465, budget_spent: 0 }),
]);

must(
  untouched.totalPlan === 254868 && untouched.totalSpent === 0,
  'the reproduction must match what the app showed',
);
must(
  untouched.savings === 0,
  `nothing is saved before any work is done, got ${untouched.savings}`,
);
must(
  untouched.remaining === 254868,
  `unspent budget is a remainder, got ${untouched.remaining}`,
);

// --- a finished project under budget is a real saving ------------------------

const finished = summarizePortfolio([
  project({ id: 'done', budget_planned: 100000, budget_spent: 80000, progress_percent: 100 }),
]);

must(
  finished.savings === 20000,
  `a completed project under budget saved the difference, got ${finished.savings}`,
);
must(
  finished.savingsPct === 20,
  `the percent is relative to the completed plan, got ${finished.savingsPct}`,
);

// --- a finished project is not diluted by an untouched one -------------------

const mixed = summarizePortfolio([
  project({ id: 'done', budget_planned: 100000, budget_spent: 80000, progress_percent: 100 }),
  project({ id: 'new', budget_planned: 900000, budget_spent: 0 }),
]);

must(
  mixed.savings === 20000,
  `only the finished project contributes to savings, got ${mixed.savings}`,
);
must(
  mixed.savingsPct === 20,
  `the percent must not be measured against the untouched project's plan, got ${mixed.savingsPct}`,
);
must(mixed.remaining === 920000, `the rest is remaining, got ${mixed.remaining}`);

// --- overspend is unaffected -------------------------------------------------

const over = summarizePortfolio([
  project({ id: 'over', budget_planned: 100000, budget_spent: 130000, progress_percent: 100 }),
]);

must(over.overspend === 30000, `overspend must still be reported, got ${over.overspend}`);
must(over.savings === 0, 'an overspent project has no savings');

// --- an empty portfolio divides by nothing -----------------------------------

const empty = summarizePortfolio([]);
must(
  empty.savings === 0 && empty.savingsPct === 0 && empty.remaining === 0,
  'an empty portfolio must not produce NaN or a phantom saving',
);

// --- the labels no longer claim a saving on untouched money ------------------

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mobile = join(__dirname, '..', '..');
for (const file of [
  'components/renova/os/OsProjectPicker.tsx',
  'components/renova/os/portfolio/PortfolioSummaryHero.tsx',
]) {
  const source = readFileSync(join(mobile, file), 'utf8');
  const savingsLine = source
    .split('\n')
    .find((line) => line.includes('Экономия ${formatRub(summary.savings)}'));
  must(Boolean(savingsLine), `${file} must still render a savings label`);
  must(
    !savingsLine!.includes('summary.variancePct'),
    `${file} must not pair the savings label with the portfolio-wide variance, which reads -100% for an unstarted project`,
  );
  must(
    source.includes('summary.remaining'),
    `${file} must show the unspent remainder as a remainder`,
  );
}

console.log('portfolioSavingsTruth.test OK');
