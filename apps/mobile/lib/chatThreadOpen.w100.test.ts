/** W100/W-unread: lifecycle mark-read после commit, без side-effect в load */
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..');
const view = readFileSync(join(root, 'components/renova/chat/ChatThreadView.tsx'), 'utf8');

console.assert(view.includes("pathname: '/work-order/[id]'"), 'Expo Router: /work-order/[id]');
console.assert(view.includes('id: m.work_order_id'), 'params.id = work_order_id');
console.assert(!view.includes('pathname: `/work-order/${m.work_order_id}`'), 'no raw /work-order/:uuid path');
console.assert(view.includes('loadMessagesRef'), 'focus uses stable loadMessagesRef');
console.assert(view.includes('setVisibleChatThread'), 'registers visible thread with store');
console.assert(view.includes('messagesReady'), 'tracks render-ready messages');
console.assert(view.includes('markThreadReadNow'), 'mark-read via commit path');
console.assert(/useFocusEffect\([\s\S]*?\[threadId, projectIdProp\]\)/.test(view), 'focus deps only threadId+projectIdProp');
// GET chat не для resolve project
console.assert(!/api\.getChat\([^)]*\)[\s\S]{0,80}resolveProjectId/.test(view), 'resolveProjectId must not call getChat');
console.assert(view.includes('findThreadProjectId'), 'project from store/inbox');
// mark-read не в loadMessages
console.assert(!/loadMessages[\s\S]*?markThreadReadNow|markThreadRead\(/.test(view.split('const loadMessages')[1]?.slice(0, 800) || ''), 'loadMessages has no mark-read');
console.log('chatThreadOpen.w100.test.ts OK');
