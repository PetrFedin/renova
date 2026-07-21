/** W135: portal/viewer share, payment create, floor plan/punch → SoT */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');

const nav = readFileSync(join(mobile, 'lib/shareAccessNav.ts'), 'utf8');
const pay = readFileSync(join(mobile, 'lib/estimatePayNav.ts'), 'utf8');
const portal = readFileSync(join(mobile, 'components/renova/PortalSharePanel.tsx'), 'utf8');
const viewer = readFileSync(join(mobile, 'components/renova/ViewerSharePanel.tsx'), 'utf8');
const floor = readFileSync(join(mobile, 'components/renova/FloorPlanPanel.tsx'), 'utf8');
const form = readFileSync(join(mobile, 'components/renova/CreatePaymentForm.tsx'), 'utf8');

console.assert(nav.includes('alertPortalLinkShared') && nav.includes('alertViewerGuestAdded'), 'share');
console.assert(nav.includes('alertFloorPlanUploaded') && nav.includes('alertFloorPunchCreated'), 'floor');
console.assert(pay.includes('alertPaymentCreated') && pay.includes('budgetTabRoute'), 'payment create');
console.assert(portal.includes('alertPortalLinkShared'), 'portal wired');
console.assert(viewer.includes('alertViewerGuestAdded'), 'viewer wired');
console.assert(floor.includes('alertFloorPunchCreated') && floor.includes('alertFloorPlanUploaded'), 'floor wired');
console.assert(!floor.includes("'Замечание в QC'"), 'punch uses shared');
console.assert(form.includes('alertPaymentCreated'), 'payment form');

console.log('journeyUnify.w135.test.ts OK');
