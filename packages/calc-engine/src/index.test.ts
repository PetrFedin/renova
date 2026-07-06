import { calcRoomMetrics, calcEstimateSummary, generateTemplateLines, calcProjectDashboard } from './index';

const metrics = calcRoomMetrics({ lengthM: 4.2, widthM: 3.1, heightM: 2.7, openingsSqM: 2 });
console.assert(metrics.floorSqM === 13.02, 'floor');
const { works, materials } = generateTemplateLines('cosmetic', 'r1', metrics);
const summary = calcEstimateSummary(materials, works);
console.assert(summary.grandTotal > 0, 'total');
const dash = calcProjectDashboard({
  stages: [{ weight: 1, percentComplete: 50 }, { weight: 2, percentComplete: 30 }],
  budgetPlanned: 847000,
  budgetSpent: 412000,
  materialPlanned: 200000,
  materialSpent: 216000,
  plannedEndDate: new Date('2026-08-01'),
});
console.log('calc-engine OK', { metrics, summary, dash });
