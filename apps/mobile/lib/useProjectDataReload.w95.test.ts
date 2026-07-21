/**
 * W95: estimate/pay/punch/notify surfaces on projectDataBus.
 * Run: npx tsx apps/mobile/lib/useProjectDataReload.w95.test.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const files = [
  'components/screens/estimate/CustomerEstimateView.tsx',
  'components/screens/stage/StageDetailPaymentBlock.tsx',
  'components/renova/FloorPlanPanel.tsx',
  'components/renova/NotificationCenter.tsx',
];

for (const rel of files) {
  const src = readFileSync(join(root, rel), 'utf8');
  if (!src.includes('useProjectDataReload')) {
    throw new Error(`W95 missing useProjectDataReload: ${rel}`);
  }
}

const docs = readFileSync(join(root, 'components/renova/DocumentsHub.tsx'), 'utf8');
if (!docs.includes('runDocumentOcr') || !docs.includes('syncProjectSideEffects')) {
  throw new Error('DocumentsHub OCR should sync side effects');
}

console.log('useProjectDataReload.w95.test OK', files.length, 'surfaces');
