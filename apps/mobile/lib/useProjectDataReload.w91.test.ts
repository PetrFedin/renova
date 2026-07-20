/**
 * W91: surfaces that must call useProjectDataReload.
 * Run: npx tsx apps/mobile/lib/useProjectDataReload.w91.test.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const files = [
  'components/screens/OsWorksScreen.tsx',
  'components/screens/WorkOrderDetailScreen.tsx',
  'components/screens/ScratchpadScreen.tsx',
  'components/screens/OsRoomsScreen.tsx',
  'components/renova/ActivityFeed.tsx',
  'components/renova/DecisionHistoryPanel.tsx',
  'components/renova/WorkOrdersListPanel.tsx',
  'components/renova/ProjectAnalyticsPanel.tsx',
  'components/renova/StageExpensePanel.tsx',
  'components/renova/chat/ChatListView.tsx',
];

for (const rel of files) {
  const src = readFileSync(join(root, rel), 'utf8');
  if (!src.includes('useProjectDataReload')) {
    throw new Error(`W91 missing useProjectDataReload: ${rel}`);
  }
}
console.log('useProjectDataReload.w91.test OK', files.length, 'surfaces');
