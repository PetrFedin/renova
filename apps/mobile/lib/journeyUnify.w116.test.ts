/** W116: calendar offline; activity/docs/stage via pushOsNav SoT */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const cal = readFileSync(join(mobile, 'lib/api/calendar.ts'), 'utf8');
const feed = readFileSync(join(mobile, 'components/renova/ActivityFeed.tsx'), 'utf8');
const links = readFileSync(join(mobile, 'components/renova/StageExpenseLinksPanel.tsx'), 'utf8');
const hero = readFileSync(join(mobile, 'components/screens/stage/StageDetailHero.tsx'), 'utf8');
const budget = readFileSync(join(mobile, 'components/screens/budget/BudgetSummarySection.tsx'), 'utf8');
const pay = readFileSync(join(mobile, 'components/renova/PaymentDetailSheet.tsx'), 'utf8');
const accept = readFileSync(join(mobile, 'app/work-acceptance.tsx'), 'utf8');
const ical = readFileSync(join(mobile, 'components/renova/IcalImportButton.tsx'), 'utf8');
const changes = readFileSync(join(mobile, 'components/screens/estimate/EstimateChangesLayer.tsx'), 'utf8');

console.assert(cal.includes('updateStageDates') && cal.includes('offline_queued'), 'calendar dates offline');
console.assert(cal.includes('importIcal') && cal.includes('offline_queued'), 'ical import offline');
console.assert(feed.includes("pushOsNav(it.link_path, back, role)"), 'activity SoT');
console.assert(feed.includes("pushOsNav('/activity'"), 'activity archive SoT');
console.assert(links.includes("pathname: '/stage/[id]'") && links.includes('role'), 'expense→stage SoT');
console.assert(hero.includes("pushOsNav('/documents'") || hero.includes('openDocs'), 'hero docs SoT');
console.assert(budget.includes("pathname: '/documents'") && budget.includes('focus: \'co\''), 'budget CO docs');
console.assert(pay.includes('scan-receipt') && pay.includes('role)'), 'payment scan role');
console.assert(pay.includes('repairTabRoute(role, \'control\')'), 'payment→accept SoT');
console.assert(accept.includes("tab: 'control'"), 'acceptance deeplink→hub SoT');
console.assert(ical.includes('notifyOfflineQueued'), 'ical UX offline');
console.assert(changes.includes("pushOsNav('/documents'"), 'CO sign SoT');

console.log('journeyUnify.w116.test.ts OK');
