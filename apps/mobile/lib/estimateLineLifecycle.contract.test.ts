import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const read = (relative: string) => readFileSync(join(mobile, relative), 'utf8');
const must = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

const api = read('lib/api/estimateLifecycle.ts');
const contractor = read('components/screens/estimate/ContractorEstimateView.tsx');
const customer = read('components/screens/estimate/CustomerEstimateView.tsx');
const editor = read('components/renova/estimate/EstimateEditorByRoom.tsx');
const card = read('components/renova/estimate/EstimateLineEditorCard.tsx');
const removed = read('components/renova/estimate/RemovedEstimateLinesPanel.tsx');

must(
  api.includes("action: 'remove' | 'restore'")
    && api.includes("error instanceof ApiError && error.status >= 400 && error.status < 500")
    && api.includes("throw new Error('offline_queued')"),
  'remove/restore must be replayable on transport ambiguity but deterministic 4xx must not queue',
);
must(
  contractor.includes("line.origin !== 'system'")
    && contractor.includes('lifecycleHealthy')
    && contractor.includes('removableIds.has(line.id)')
    && contractor.includes('!project.estimate_locked_at'),
  'contractor remove capability must come from confirmed backend lifecycle truth and fail closed when locked/stale',
);
must(
  contractor.includes('await api.removeEstimateLine')
    && contractor.includes('await api.restoreEstimateLine')
    && contractor.includes('await loadProject(project.id);')
    && contractor.includes('await loadLifecycle();'),
  'remove/restore must reconcile both project totals and lifecycle history after commit',
);
must(
  editor.includes('canRemove={Boolean(removableIds?.has(line.id))}')
    && card.includes('title="Убрать из сметы"')
    && card.includes('variant="dangerOutline"'),
  'destructive CTA must exist only for lifecycle-qualified active lines and remain visually explicit',
);
must(
  customer.includes('<RemovedEstimateLinesPanel')
    && customer.includes('role="customer"')
    && customer.includes('canRestore={false}')
    && customer.includes('lifecycleError'),
  'customer must see removed history read-only and must not fabricate an empty archive on lifecycle read failure',
);
must(
  removed.includes("role === 'contractor' && canRestore && onRestore")
    && removed.includes('title="Восстановить"')
    && removed.includes('с тем же ID'),
  'restore control must remain contractor-only and communicate identity-preserving recovery',
);

console.log('estimateLineLifecycle.contract.test OK');
