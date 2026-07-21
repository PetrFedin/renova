/** W125: acceptance → pay/plan SoT + ✓ pin on floor plan (Fieldwire-style) */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');

const nav = readFileSync(join(mobile, 'lib/acceptanceNav.ts'), 'utf8');
const wa = readFileSync(join(mobile, 'components/screens/WorkAcceptanceScreen.tsx'), 'utf8');
const list = readFileSync(join(mobile, 'components/renova/UnifiedAcceptanceList.tsx'), 'utf8');
const floor = readFileSync(join(mobile, 'components/renova/FloorPlanPanel.tsx'), 'utf8');

console.assert(nav.includes('alertStageAccepted') && nav.includes("objectTabRoute(role, 'plan')"), 'nav→plan');
console.assert(nav.includes("budgetTabRoute(role, 'payments')"), 'nav→payments');
console.assert(wa.includes('alertStageAccepted') && !wa.includes('budgetTabRoute'), 'WA uses shared alert');
console.assert(list.includes('alertStageAccepted'), 'list uses shared alert');
console.assert(floor.includes('pinAccepted') && floor.includes('acceptLegend'), 'floor ✓ style');
console.assert(floor.includes("startsWith('✓')"), 'detect acceptance pin label');

console.log('journeyUnify.w125.test.ts OK');
