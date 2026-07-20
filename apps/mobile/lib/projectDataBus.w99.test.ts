/**
 * W99: ICS/CSV/receipt-bulk/FAB call syncProjectSideEffects.
 * Run: npx tsx apps/mobile/lib/projectDataBus.w99.test.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');

const checks: [string, string[]][] = [
  ['components/renova/IcalImportButton.tsx', ['importIcal', 'syncProjectSideEffects']],
  ['components/renova/schedule/ScheduleIconToolbar.tsx', ['importIcal', 'syncProjectSideEffects']],
  ['components/screens/estimate/EstimateDocumentsLayer.tsx', ['importEstimateCsv', 'syncProjectSideEffects', 'loadProject']],
  ['components/renova/ReceiptBulkCategoryPanel.tsx', ['patchReceipt', 'syncProjectSideEffects']],
  ['components/renova/ReceiptBulkLinkPanel.tsx', ['patchReceipt', 'syncProjectSideEffects']],
  ['components/renova/os/OsQuickFab.tsx', ['onCreated', 'syncProjectSideEffects']],
];

for (const [rel, needles] of checks) {
  const src = readFileSync(join(root, rel), 'utf8');
  for (const n of needles) {
    if (!src.includes(n)) throw new Error(`W99 ${rel} missing ${n}`);
  }
}

console.log('projectDataBus.w99.test OK', checks.length, 'surfaces');
