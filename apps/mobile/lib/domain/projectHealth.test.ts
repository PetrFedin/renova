import { computeProjectHealth, forecastFinalCost, capOverrunRisk } from './projectHealth';

const ok = computeProjectHealth({
  budgetPlanned: 1_000_000,
  budgetSpent: 400_000,
  progressPercent: 50,
  overdueStages: 0,
  reviewStages: 1,
  reworkStages: 0,
  materialsNeedBuy: 2,
  materialsShortage: 0,
  pendingPayments: 0,
  budgetAlerts: 0,
});
if (ok.score < 70 || ok.score > 100) throw new Error('health score range');
if (forecastFinalCost(1_000_000, 500_000, 50) !== 1_000_000) throw new Error('forecast');
if (forecastFinalCost(521_672, 76_000, 6) !== 521_672) throw new Error('forecast low progress');
if (capOverrunRisk(1_312_116, 521_672) !== Math.round(521_672 * 0.35)) throw new Error('overrun cap');
console.log('projectHealth.test OK');
