/** W100: открытие задачи из чата + порядок mark-as-read */
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..');
const view = readFileSync(join(root, 'components/renova/chat/ChatThreadView.tsx'), 'utf8');

console.assert(view.includes("pathname: '/work-order/[id]'"), 'Expo Router: /work-order/[id]');
console.assert(view.includes('id: m.work_order_id'), 'params.id = work_order_id');
console.assert(!view.includes('pathname: `/work-order/${m.work_order_id}`'), 'no raw /work-order/:uuid path');
console.assert(view.indexOf('await loadMessages()') < view.indexOf('await markThreadRead()'), 'load before mark on focus');
console.assert(view.includes('Новое сообщение в открытом треде'), 'WS remakes read');
console.log('chatThreadOpen.w100.test.ts OK');
