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

console.log('summarizePortfolio.test OK');
