/** W101–W105: journey unify smoke — links, inbox honesty, acceptance naming */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const repo = join(__dirname, '../../..'); // apps/mobile/lib → monorepo renova root
const push = readFileSync(join(mobile, 'lib/pushLinks.ts'), 'utf8');
const inbox = readFileSync(join(mobile, 'lib/domain/buildInboxItems.ts'), 'utf8');
const accept = readFileSync(join(mobile, 'components/renova/UnifiedAcceptanceList.tsx'), 'utf8');
const chat = readFileSync(join(mobile, 'components/renova/chat/ChatThreadView.tsx'), 'utf8');
const portalApi = readFileSync(join(repo, 'backend/app/api/v1/portal.py'), 'utf8');
const portalUi = readFileSync(join(mobile, 'app/portal.tsx'), 'utf8');
const stage = readFileSync(join(mobile, 'components/screens/StageDetailScreen.tsx'), 'utf8');
const wo = readFileSync(join(mobile, 'components/screens/WorkOrderDetailScreen.tsx'), 'utf8');
const notifList = readFileSync(join(mobile, 'components/renova/NotificationsList.tsx'), 'utf8');

console.assert(push.includes("canonicalPath === '/profile'"), 'profile alias');
console.assert(push.includes("canonicalPath === '/design'"), 'design alias');
console.assert(push.includes("quality-control' && role === 'customer'"), 'qc customer');
console.assert(inbox.includes('estimate_lock_proposed_at'), 'estimate inbox honesty');
console.assert(accept.includes("'Принять этап'"), 'accept naming');
console.assert(chat.includes('createInvoice'), 'chat invoice amounts');
console.assert(portalApi.includes('portal_lock_estimate'), 'portal lock API');
console.assert(portalUi.includes('Зафиксировать смету'), 'portal lock UI');
console.assert(stage.includes('syncProjectSideEffects'), 'stage bus');
console.assert(wo.includes("a.next === 'paid'"), 'WO → payments');
console.assert(notifList.includes('resolveNotificationLink'), 'notif fallback');
console.log('journeyUnify.w101.test.ts OK');
