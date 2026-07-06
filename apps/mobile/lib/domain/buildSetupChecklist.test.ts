import { buildSetupChecklist, setupChecklistProgress, nextSetupItem, shouldShowSetupChecklist } from './buildSetupChecklist';
import type { ProjectDetail } from '../api';
import type { ProjectOsSnapshot } from './osTypes';

const baseProject = {
  id: 'p1',
  name: 'Test',
  address: 'ул. Test 1',
  planned_start_date: '2026-01-01',
  planned_end_date: '2026-06-01',
  rooms: [{ id: 'r1' }],
  estimate_lines: [{ id: 'e1' }],
  stages: [],
  contractor_id: null,
  customer_budget: 100000,
} as unknown as ProjectDetail;

const baseSnap = {
  isComplete: false,
  pendingPayments: 0,
  schedule: { progressPercent: 0 },
} as unknown as ProjectOsSnapshot;

const items = buildSetupChecklist(baseProject, baseSnap, 'customer');
if (items.find((i) => i.id === 'object')?.done !== true) throw new Error('object always done');
if (items.find((i) => i.id === 'rooms')?.done !== true) throw new Error('rooms done');
if (items.find((i) => i.id === 'contractor')?.href.includes('focus=contractor') !== true) throw new Error('contractor href');
if (items.find((i) => i.id === 'contractor')?.done !== false) throw new Error('contractor pending');

const progress = setupChecklistProgress(items);
if (progress < 40 || progress > 90) throw new Error(`unexpected progress ${progress}`);

const next = nextSetupItem(items);
if (!next || next.done) throw new Error('expected pending next item');

if (!shouldShowSetupChecklist(items, false)) throw new Error('should show checklist');
if (shouldShowSetupChecklist(items, true)) throw new Error('dismiss hides');

console.log('buildSetupChecklist.test OK');
