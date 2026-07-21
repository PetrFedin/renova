/** W115: profile/materials/estimate/fab role SoT; chat pin/react offline; deps sync offline */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const cust = readFileSync(join(mobile, 'components/screens/profile/CustomerProfileScreen.tsx'), 'utf8');
const contr = readFileSync(join(mobile, 'components/screens/profile/ContractorProfileScreen.tsx'), 'utf8');
const mat = readFileSync(join(mobile, 'components/screens/OsMaterialsScreen.tsx'), 'utf8');
const fab = readFileSync(join(mobile, 'components/renova/os/OsQuickFab.tsx'), 'utf8');
const est = readFileSync(join(mobile, 'components/screens/estimate/EstimateSummaryLayer.tsx'), 'utf8');
const passport = readFileSync(join(mobile, 'components/renova/os/RoomPassport.tsx'), 'utf8');
const chats = readFileSync(join(mobile, 'lib/api/chats.ts'), 'utf8');
const issues = readFileSync(join(mobile, 'lib/api/issues.ts'), 'utf8');
const deps = readFileSync(join(mobile, 'components/renova/StageDependenciesPanel.tsx'), 'utf8');
const chatUi = readFileSync(join(mobile, 'components/renova/chat/ChatThreadView.tsx'), 'utf8');
const scratch = readFileSync(join(mobile, 'components/screens/ScratchpadScreen.tsx'), 'utf8');

console.assert(cust.includes("pushOsNav('/documents', pathname, 'customer')"), 'customer docs role');
console.assert(cust.includes("pushOsNav('/wizard/type', pathname, 'customer')"), 'customer wizard role');
console.assert(contr.includes("pushOsNav('/approvals', nav.from, 'contractor')"), 'contractor approvals role');
console.assert(contr.includes("pushOsNav('/documents', nav.from, 'contractor')"), 'contractor docs role');
console.assert(mat.includes("pushOsNav('/scan-receipt', pathname, role)"), 'materials scan role');
console.assert(fab.includes('`${prefix}/chat`, pathname, role'), 'fab chat role');
console.assert(est.includes("pushOsNav('/documents', pathname, 'customer')"), 'estimate docs role');
console.assert(passport.includes('pushOsNav(budgetRoute, pathname, role)'), 'passport budget role');
console.assert(chats.includes('patchChatState') && chats.includes('offline_queued'), 'chat state offline');
console.assert(chats.includes('reactChatMessage') && chats.includes('offline_queued'), 'chat react offline');
console.assert(chats.includes('pinChatMessage') && chats.includes('offline_queued'), 'chat pin offline');
console.assert(issues.includes('syncDependencies') && issues.includes('enqueueOffline'), 'deps sync offline');
console.assert(deps.includes('notifyOfflineQueued') && deps.includes('pushOsNav'), 'deps panel UX+nav');
console.assert(chatUi.includes('notifyOfflineQueued(\'Реакция\')') || chatUi.includes("notifyOfflineQueued('Реакция')"), 'react UX');
console.assert(scratch.includes('returnTo, role)'), 'scratchpad role');

console.log('journeyUnify.w115.test.ts OK');
