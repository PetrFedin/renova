/** W111: inbox role SoT, warranty/QC links, WO+scratchpad offline */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const inbox = readFileSync(join(mobile, 'lib/domain/buildInboxItems.ts'), 'utf8');
const unified = readFileSync(join(mobile, 'components/screens/UnifiedInboxScreen.tsx'), 'utf8');
const wo = readFileSync(join(mobile, 'lib/api/workOrders.ts'), 'utf8');
const pad = readFileSync(join(mobile, 'lib/api/scratchpad.ts'), 'utf8');
const chat = readFileSync(join(mobile, 'components/renova/chat/ChatThreadView.tsx'), 'utf8');

console.assert(unified.includes('pushOsNav(it.href, returnTo, role)'), 'inbox push with role');
console.assert(inbox.includes("href: '/quality-control'") || inbox.includes('"/quality-control"'), 'warranty→QC');
console.assert(inbox.includes('first?.stage_id') && inbox.includes('/stage/'), 'issues-fixed→stage');
console.assert(inbox.includes('/work-order/') && inbox.includes('reviewWo[0]'), 'wo→detail');
console.assert(inbox.includes('/material/') && inbox.includes('pendingMat[0]'), 'material→detail');
console.assert(wo.includes('transitionWorkOrder') && wo.includes('offline_queued'), 'WO offline');
console.assert(pad.includes('createScratchpadLine') && pad.includes('offline_queued'), 'scratchpad offline');
console.assert(chat.includes('offline_queued') && chat.includes('Счёт отправится'), 'invoice offline UI');

console.log('journeyUnify.w111.test.ts OK');
