import { summarizePortfolio } from './summarizePortfolio';
import { partitionPortfolioProjects } from './portfolioProjects';
import { aggregatePortfolioBudgetBreakdowns } from './aggregatePortfolioBudget';

const rows = [
  { id: 'a', name: 'A', budget_planned: 1_000_000, budget_spent: 1_200_000, progress_percent: 100, pending_payments: 0 },
  { id: 'b', name: 'B', budget_planned: 2_000_000, budget_spent: 1_800_000, progress_percent: 80, pending_payments: 0 },
];

const s = summarizePortfolio(rows);
if (s.count !== 2) throw new Error('count');
if (s.totalPlan !== 3_000_000) throw new Error('totalPlan');
if (s.totalSpent !== 3_000_000) throw new Error('totalSpent');
if (s.overspend !== 0) throw new Error('net zero variance at portfolio level');
if (s.projectsOver !== 1) throw new Error('one over project');
if (s.projectsUnder !== 1) throw new Error('one under project');
if (s.completedCount !== 1) throw new Error('one completed');
if (s.inProgressCount !== 1) throw new Error('one in progress');

const { inProgress, completed } = partitionPortfolioProjects(rows as any);
if (inProgress.length !== 1 || completed.length !== 1) throw new Error('partition');

const cats = aggregatePortfolioBudgetBreakdowns([
  { works: 100, materials_plan: 200, materials_fact: 250, waste: 10, reserve: 20, total_planned: 330, budget_planned: 300, budget_spent: 280 },
  { works: 50, materials_plan: 100, materials_fact: 90, waste: 0, reserve: 0, total_planned: 150, budget_planned: 150, budget_spent: 140 },
]);
const materials = cats.find((c) => c.key === 'materials');
if (!materials || materials.planned !== 300 || materials.spent !== 340) throw new Error('materials aggregate');

// issue #318: без works_fact в ответе бэкенда факт по работам не должен молча
// приравниваться к плану как "измеренный" — помечаем его как неизвестный.
const worksNoFact = cats.find((c) => c.key === 'works');
if (!worksNoFact || worksNoFact.factAvailable !== false) throw new Error('works fact must be marked unavailable when backend omits works_fact');

// "Резерв" — расчётный остаток, не отслеживаемая статья расходов: факт не измеряется.
const reserveRow = cats.find((c) => c.key === 'reserve');
if (!reserveRow || reserveRow.factAvailable !== false) throw new Error('reserve has no independent fact');

// Когда бэкенд отдаёт реальный works_fact, он должен использоваться как факт
// (а не план), и variance по работам должен быть измеримым и ненулевым, когда
// реальные расходы отличаются от плана.
const catsWithWorksFact = aggregatePortfolioBudgetBreakdowns([
  { works: 100, works_fact: 130, materials_plan: 200, materials_fact: 200, waste: 0, reserve: 0, total_planned: 300, budget_planned: 300, budget_spent: 330 },
]);
const worksWithFact = catsWithWorksFact.find((c) => c.key === 'works');
if (!worksWithFact || worksWithFact.factAvailable !== true) throw new Error('works fact must be available when backend provides works_fact');
if (worksWithFact.spent !== 130) throw new Error('works fact must reflect real quantity_actual spend, not plan');
if (worksWithFact.spent === worksWithFact.planned) throw new Error('works fact must not be forced equal to plan (issue #318)');
if (!worksWithFact.hasOverrun) throw new Error('real works overrun must be detected once fact data exists');

console.log('summarizePortfolio.test OK');
