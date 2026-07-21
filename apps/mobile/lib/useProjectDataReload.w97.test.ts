/**
 * W97: team/directory/furniture/audit/digest wired to buses.
 * Run: npx tsx apps/mobile/lib/useProjectDataReload.w97.test.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');

const files = [
  'components/renova/FurnitureLayer.tsx',
  'components/renova/ContractorDirectory.tsx',
  'components/screens/profile/ContractorProfileScreen.tsx',
  'app/(contractor)/_screens/audit.tsx',
];

for (const rel of files) {
  const src = readFileSync(join(root, rel), 'utf8');
  if (!src.includes('useProjectDataReload')) {
    throw new Error(`W97 missing useProjectDataReload: ${rel}`);
  }
}

const dir = readFileSync(join(root, 'components/renova/ContractorDirectory.tsx'), 'utf8');
if (!dir.includes('syncProjectSideEffects') || !dir.includes('linkContractor')) {
  throw new Error('ContractorDirectory must sync after link');
}

const home = readFileSync(join(root, 'components/renova/os/home/HomeCompletionStrip.tsx'), 'utf8');
if (!home.includes('pushWeeklyDigest') || !home.includes('syncProjectSideEffects')) {
  throw new Error('digest must sync side effects');
}

console.log('useProjectDataReload.w97.test OK');
