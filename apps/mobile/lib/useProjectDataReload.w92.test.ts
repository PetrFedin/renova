/**
 * W92: surfaces that must call useProjectDataReload.
 * Run: npx tsx apps/mobile/lib/useProjectDataReload.w92.test.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const files = [
  'app/purchase/[id].tsx',
  'app/material/[id].tsx',
  'app/_stack/reports.tsx',
  'components/renova/chat/ChatThreadView.tsx',
  'components/renova/StageDependenciesPanel.tsx',
  'components/screens/OsRepairHubScreen.tsx',
];

for (const rel of files) {
  const src = readFileSync(join(root, rel), 'utf8');
  if (!src.includes('useProjectDataReload')) {
    throw new Error(`W92 missing useProjectDataReload: ${rel}`);
  }
}
console.log('useProjectDataReload.w92.test OK', files.length, 'surfaces');
