import { readFileSync } from 'node:fs';

function must(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const docs = readFileSync('apps/mobile/components/renova/DocumentsHub.tsx', 'utf8');

must(
  !docs.includes(".catch(() => ({ open: 0"),
  'warranty decision read must not fabricate zero open claims on API failure',
);
must(
  docs.includes("reportError('DocumentsHub.WarrantyDecisionRead'"),
  'warranty decision read failure must be observable',
);
must(
  docs.includes("withBusy('warranty-create-extra'"),
  'nested create-another action must use the shared observable busy/error boundary',
);
must(
  docs.includes("withBusy('warranty-close'"),
  'nested warranty close action must use the shared observable busy/error boundary',
);

console.log('warrantyDecisionRead.w179.test OK');
