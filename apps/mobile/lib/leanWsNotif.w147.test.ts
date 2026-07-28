/** Investor P2: lean home + WS honesty + notif→inbox */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const home = readFileSync(join(mobile, 'components/renova/os/home/HomeScreenBody.tsx'), 'utf8');
const badge = readFileSync(join(mobile, 'components/renova/IntegrationHonestyBadge.tsx'), 'utf8');
const notif = readFileSync(join(mobile, 'components/renova/NotificationsList.tsx'), 'utf8');
const receipt = readFileSync(join(mobile, 'lib/receiptNav.ts'), 'utf8');
const dir = readFileSync(join(mobile, 'components/renova/ContractorDirectory.tsx'), 'utf8');

console.assert(home.includes('!leanFirstViewport && snap.quality.awaitingAcceptance'), 'lean hides acceptance banner');
console.assert(badge.includes('Inbox WS') && badge.includes('useInboxWsConnected'), 'WS honesty chip');
console.assert(notif.includes('/inbox') && !notif.includes('listNotifications'), 'NotificationsList → inbox only');
console.assert(receipt.includes('verify_mode') && receipt.includes('не налоговая правда'), 'scan FNS mode');
console.assert(dir.includes('Нужна подписка Pro'), 'assign paywall honesty');

console.log('leanWsNotif.w147.test OK');
