/** Investor P1/P2: единый «Ещё» + FAB только create */
import { readFileSync } from 'fs';
import { join } from 'path';
import { HEADER_MORE_LINK_IDS } from '../constants/osSections';
import { fabActionIdsForLevel } from './detailLevelPolicy';

const mobile = join(__dirname, '..');
const home = readFileSync(join(mobile, 'components/renova/os/home/HomeScreenBody.tsx'), 'utf8');
const fab = readFileSync(join(mobile, 'components/renova/os/OsQuickFab.tsx'), 'utf8');

console.assert(HEADER_MORE_LINK_IDS.includes('documents') && HEADER_MORE_LINK_IDS.includes('inbox'), 'header link ids');
console.assert(home.includes('HEADER_MORE_LINK_IDS'), 'Home excludes header util links');
console.assert(!fab.includes("id: 'remark'") && !fab.includes("id: 'photo'"), 'customer FAB without competing remark/photo');
console.assert(fab.includes("id: 'expense'") && fab.includes("id: 'chat'"), 'FAB keeps create expense+chat');

const std = fabActionIdsForLevel('standard', 'customer');
console.assert(std && std.size === 2 && std.has('expense') && std.has('chat'), 'customer FAB policy = create only');

console.log('moreUnifyFab.w146.test OK');
