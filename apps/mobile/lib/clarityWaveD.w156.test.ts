/** Clarity D: Решение / sign-first docs / estimate pending Δ */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const control = readFileSync(join(mobile, 'components/screens/control/CustomerControlView.tsx'), 'utf8');
const contractor = readFileSync(join(mobile, 'components/screens/control/ContractorControlView.tsx'), 'utf8');
const accept = readFileSync(join(mobile, 'components/renova/UnifiedAcceptanceList.tsx'), 'utf8');
const docs = readFileSync(join(mobile, 'components/renova/DocumentsHub.tsx'), 'utf8');
const estimate = readFileSync(join(mobile, 'components/screens/estimate/EstimateChangesLayer.tsx'), 'utf8');

console.assert(control.includes('Решение') && control.includes('decisionHint'), 'control Решение');
console.assert(contractor.includes('Решение у заказчика'), 'contractor Решение');
console.assert(accept.includes('ActionConfirmSheet') && accept.includes('EmptyActionState'), 'accept sheet/empty');
console.assert(accept.includes("title=\"Принять\"") && accept.includes("title=\"Вернуть\""), 'accept CTAs');
console.assert(docs.includes('needsSignDocs') && docs.includes('Нужно подписать'), 'docs sign pin');
console.assert(docs.includes('expandedSections') && docs.includes('chevron-down'), 'docs collapse');
console.assert(estimate.includes('pendingDelta') && estimate.includes('К бюджету'), 'estimate Δ');

const ok =
  control.includes('Решение') &&
  docs.includes('Нужно подписать') &&
  estimate.includes('pendingDelta');
if (!ok) process.exit(1);
console.log('clarityWaveD.w156.test OK');
