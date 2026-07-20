/** W110: pushOsNav=resolvePushLink SoT; lock/design/room/chat invoice offline */
import { readFileSync } from 'fs';
import { join } from 'path';
import { resolvePushLink } from './pushLinks';

const mobile = join(__dirname, '..');
const pushNav = readFileSync(join(mobile, 'lib/pushOsNav.ts'), 'utf8');
const nav = readFileSync(join(mobile, 'lib/navigation.ts'), 'utf8');
const estimate = readFileSync(join(mobile, 'lib/api/estimate.ts'), 'utf8');
const design = readFileSync(join(mobile, 'lib/api/design.ts'), 'utf8');
const rooms = readFileSync(join(mobile, 'lib/api/rooms.ts'), 'utf8');
const chats = readFileSync(join(mobile, 'lib/api/chats.ts'), 'utf8');
const search = readFileSync(join(mobile, 'components/renova/GlobalSearchBar.tsx'), 'utf8');

console.assert(pushNav.includes('resolvePushLink'), 'pushOsNav SoT');
console.assert(nav.includes('pushOsNav(target, pathname, role)'), 'pushNav passes role');
console.assert(estimate.includes('estimate/lock') && estimate.includes('offline_queued'), 'lock offline');
console.assert(design.includes('submitDesignPackage') && design.includes('offline_queued'), 'design submit offline');
console.assert(rooms.includes('createRoom') && rooms.includes('offline_queued'), 'createRoom offline');
console.assert(chats.includes('invoiceFromChat') && chats.includes('offline_queued'), 'invoice offline');
console.assert(search.includes('/chat/[threadId]'), 'search chat dynamic');

const ctrlC = resolvePushLink('/control', '/home', 'customer');
console.assert(ctrlC?.pathname?.includes('repair') && ctrlC.params?.tab === 'control', 'control customer');
const ctrlK = resolvePushLink('/control', '/home', 'contractor');
console.assert(ctrlK?.pathname?.includes('contractor') && ctrlK.params?.tab === 'control', 'control contractor');

console.log('journeyUnify.w110.test.ts OK');
