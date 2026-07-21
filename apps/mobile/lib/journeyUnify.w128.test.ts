/** W128: purchase lifecycle → budget fact + selection propose/approve SoT */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');

const nav = readFileSync(join(mobile, 'lib/procurementNav.ts'), 'utf8');
const mats = readFileSync(join(mobile, 'components/screens/OsMaterialsScreen.tsx'), 'utf8');
const detail = readFileSync(join(mobile, 'app/purchase/[id].tsx'), 'utf8');
const sel = readFileSync(join(mobile, 'components/screens/OsSelectionsScreen.tsx'), 'utf8');

console.assert(nav.includes('alertPurchaseAdvanced') && nav.includes("'delivered'"), 'advance→fact');
console.assert(nav.includes('alertSelectionApproved') && nav.includes('alertSelectionProposed'), 'selection alerts');
console.assert(nav.includes('calendarTabRoute') && nav.includes("budgetTabRoute(role, 'expenses')"), 'budget+calendar SoT');
console.assert(mats.includes('alertPurchaseAdvanced'), 'materials list advance');
console.assert(detail.includes('alertPurchaseAdvanced') && detail.includes('PURCHASE_NEXT_STATUS'), 'detail DRY+alert');
console.assert(detail.includes('Расходы бюджета') && detail.includes("budgetTabRoute(role, 'expenses')"), 'detail→expenses');
console.assert(sel.includes('alertSelectionApproved') && sel.includes('alertSelectionProposed'), 'selections wired');

console.log('journeyUnify.w128.test.ts OK');
