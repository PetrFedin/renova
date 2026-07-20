/**
 * W96: secondary surfaces on projectDataBus.
 * Run: npx tsx apps/mobile/lib/useProjectDataReload.w96.test.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const files = [
  'components/renova/WasteOrderList.tsx',
  'components/renova/JobLeadsBoard.tsx',
  'components/renova/DesignPackageList.tsx',
  'components/renova/ViewerSharePanel.tsx',
  'components/renova/MaterialPickList.tsx',
  'components/renova/NotificationsList.tsx',
  'components/renova/PlanSchedulePanel.tsx',
  'components/screens/RoomDetailScreen.tsx',
];

for (const rel of files) {
  const src = readFileSync(join(root, rel), 'utf8');
  if (!src.includes('useProjectDataReload')) {
    throw new Error(`W96 missing useProjectDataReload: ${rel}`);
  }
}
console.log('useProjectDataReload.w96.test OK', files.length, 'surfaces');
