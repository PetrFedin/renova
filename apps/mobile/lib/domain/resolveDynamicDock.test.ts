import { readFileSync } from 'node:fs';
import { resolveDockPresetMode, dockPresetItems, shouldUseDynamicDock, minimalSnapFromProject } from './resolveDynamicDock';
import type { ProjectDetail } from '../api';

const project = {
  id: 'p1',
  name: 'T',
  address: 'a',
  renovation_type: 'cosmetic',
  budget_planned: 100,
  budget_spent: 0,
  progress_percent: 10,
  rooms_count: 1,
  stages_count: 0,
  rooms: [{ id: 'r1' }],
  estimate_lines: [],
  stages: [],
  contractor_id: null,
} as unknown as ProjectDetail;

const snap = minimalSnapFromProject(project);

// Historical preset helpers remain deterministic until they can be removed with full reference proof.
const setup = resolveDockPresetMode(project, snap, 'customer');
if (setup !== 'setup') throw new Error('early project = setup historical preset');
if (dockPresetItems('setup').length !== 5) throw new Error('setup historical preset = 5 items');

const withStages = {
  ...project,
  estimate_lines: [{ id: 'e1' }],
  stages: [{ id: 's1', status: 'active' }],
  contractor_id: 'c1',
  customer_budget: 100000,
  planned_start_date: '2026-01-01',
  planned_end_date: '2026-06-01',
} as unknown as ProjectDetail;

const repair = resolveDockPresetMode(withStages, minimalSnapFromProject(withStages), 'customer');
if (repair !== 'repair') throw new Error('ready project = repair historical preset');

if (shouldUseDynamicDock('contractor', 'standard', 'active')) throw new Error('historical preset policy excluded contractor');
if (shouldUseDynamicDock('customer', 'detailed', 'active')) throw new Error('historical preset policy excluded detailed prefs');

const dock = readFileSync('components/renova/os/OsDockBar.tsx', 'utf8');
if (!dock.includes('getDockBar(role).then(applyItems)')) throw new Error('production Dock must load explicit prefs/default');
if (!dock.includes('subscribeDockBar(reloadPrefs)')) throw new Error('production Dock must react to explicit preference changes');
if (dock.includes('resolveDynamicDockItems(') || dock.includes('minimalSnapFromProject(')) {
  throw new Error('production Dock must not rearrange automatically from project phase');
}
if (dock.includes('useDetailLevel()')) throw new Error('detail level must not silently rearrange primary navigation');

console.log('resolveDynamicDock.test OK');
