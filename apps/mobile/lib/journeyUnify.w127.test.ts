/** W127: selections→purchase→budget + CO submit/approve SoT (Buildertrend) */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');

const nav = readFileSync(join(mobile, 'lib/procurementNav.ts'), 'utf8');
const list = readFileSync(join(mobile, 'components/renova/MaterialPickList.tsx'), 'utf8');
const sheet = readFileSync(join(mobile, 'components/renova/MaterialPickDetailSheet.tsx'), 'utf8');
const mats = readFileSync(join(mobile, 'components/screens/OsMaterialsScreen.tsx'), 'utf8');
const co = readFileSync(join(mobile, 'components/screens/estimate/ContractorEstimateView.tsx'), 'utf8');
const changes = readFileSync(join(mobile, 'components/screens/estimate/EstimateChangesLayer.tsx'), 'utf8');
const detail = readFileSync(join(mobile, 'app/material/[id].tsx'), 'utf8');

console.assert(nav.includes('alertMaterialPickApproved') && nav.includes('alertPurchaseCreated'), 'nav picks+purchase');
console.assert(nav.includes('alertChangeOrderSubmitted') && nav.includes('alertChangeOrderApproved'), 'nav CO');
console.assert(list.includes('alertMaterialPickApproved') && list.includes('alertMaterialPickSubmitted'), 'list');
console.assert(sheet.includes('alertMaterialPickApproved'), 'sheet');
console.assert(mats.includes('alertPurchaseCreated'), 'materials purchase CTA');
console.assert(co.includes('alertChangeOrderSubmitted'), 'contractor CO submit');
console.assert(changes.includes('alertChangeOrderApproved'), 'CO approve→budget');
console.assert(detail.includes('alertMaterialPickApproved') && detail.includes('alertMaterialPickSubmitted'), 'material detail');

console.log('journeyUnify.w127.test.ts OK');
