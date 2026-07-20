/** W66 #19 smoke — npx tsx lib/domain/buildSetupChecklist.w66.test.ts */
import { buildSetupChecklist } from './buildSetupChecklist';
import type { ProjectDetail } from '@/lib/api';
import type { ProjectOsSnapshot } from './osTypes';

const project = {
  id: 'p1',
  name: 't',
  customer_budget: 0,
  budget_planned: 0,
  rooms: [{ id: 'r1' }],
  estimate_lines: [{ id: 'e1' }],
  estimate_locked_at: '2026-01-01',
  contractor_id: 'c1',
  stages: [{ id: 's1' }],
} as unknown as ProjectDetail;
const snap = { schedule: { progressPercent: 40 } } as unknown as ProjectOsSnapshot;
const items = buildSetupChecklist(project, snap, 'customer');
const budget = items.find((i) => i.id === 'budget');
if (budget?.done) {
  throw new Error('budget must not be done when only schedule progress is set');
}
console.log('buildSetupChecklist.w66: OK');
