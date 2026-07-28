/** Investor P2: punch discovery — deep-link, inbox CTA, QC/Control → floor */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');

const os = readFileSync(join(mobile, 'constants/osSections.ts'), 'utf8');
const floor = readFileSync(join(mobile, 'components/renova/FloorPlanPanel.tsx'), 'utf8');
const planScr = readFileSync(join(mobile, 'components/screens/OsPlanTabScreen.tsx'), 'utf8');
const overview = readFileSync(join(mobile, 'components/screens/object/PlanTabOverview.tsx'), 'utf8');
const inbox = readFileSync(join(mobile, 'lib/domain/buildInboxItems.ts'), 'utf8');
const share = readFileSync(join(mobile, 'lib/shareAccessNav.ts'), 'utf8');
const qc = readFileSync(join(mobile, 'components/screens/QualityControlScreen.tsx'), 'utf8');
const control = readFileSync(join(mobile, 'components/screens/control/CustomerControlView.tsx'), 'utf8');

console.assert(share.includes('planPunchRoute') && share.includes("'plan', 'floor'"), 'planPunchRoute');
console.assert(floor.includes("punchParam === '1'") && floor.includes('setPunchMode(true)'), 'deep-link punch');
console.assert(!floor.includes('Punch list'), 'no EN Punch list empty');
console.assert(planScr.includes('punchParam') && planScr.includes("setSub('floor')"), 'plan tab forces floor');
console.assert(overview.includes('planPunchRoute') && overview.includes('Сфоткать дефект'), 'overview CTA');
console.assert(inbox.includes('floor-punch') && inbox.includes('punch=1'), 'inbox discovery');
console.assert(share.includes('planPunchRoute') && share.includes("'plan', 'floor'"), 'share → floor/punch');
console.assert(qc.includes("objectTabRoute(role, 'plan', 'floor')"), 'QC → floor');
console.assert(control.includes('На план') && control.includes("'plan', 'floor'"), 'control → floor');

console.log('punchDiscovery.w150.test OK');

if (
  !(
    share.includes('planPunchRoute') &&
    floor.includes("punchParam === '1'") &&
    overview.includes('Сфоткать дефект') &&
    inbox.includes('floor-punch') &&
    qc.includes("objectTabRoute(role, 'plan', 'floor')")
  )
) {
  process.exit(1);
}
