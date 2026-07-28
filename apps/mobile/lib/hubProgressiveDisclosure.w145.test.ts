/** Investor P2: hub progressive disclosure — secondary tabs + «Все» */
import { readFileSync } from 'fs';
import { join } from 'path';
import { budgetHubTabsForRole } from '../constants/budgetTabs';

const mobile = join(__dirname, '..');
const hub = readFileSync(join(mobile, 'components/renova/os/OsHubTabs.tsx'), 'utf8');
const repair = readFileSync(join(mobile, 'components/screens/OsRepairHubScreen.tsx'), 'utf8');

console.assert(hub.includes('secondary'), 'OsHubTabs supports secondary');
console.assert(hub.includes('>Все</Text>'), 'OsHubTabs has Все CTA');
console.assert(repair.includes('secondary:'), 'repair marks secondary tabs');

const cust = budgetHubTabsForRole('customer');
const contr = budgetHubTabsForRole('contractor');
console.assert(cust.filter((t) => t.secondary).map((t) => t.id).join(',') === 'expenses,deviations', 'customer secondary budget');
console.assert(contr.filter((t) => t.secondary).map((t) => t.id).join(',') === 'expenses,deviations', 'contractor secondary budget');

console.log('hubProgressiveDisclosure.w145.test OK');
