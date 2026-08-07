/** Investor P1/P2: единый «Ещё» + FAB только create */
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildSecondaryNavigation } from './navigation/navigationPolicy';
import { DOCK_DEFAULT } from '../constants/dockBar';
import { fabActionIdsForLevel } from './detailLevelPolicy';

const mobile = join(__dirname, '..');
const home = readFileSync(join(mobile, 'components/renova/os/home/HomeScreenBody.tsx'), 'utf8');
const fab = readFileSync(join(mobile, 'components/renova/os/OsQuickFab.tsx'), 'utf8');

const headerIds = buildSecondaryNavigation({ role: 'customer', dockItems: DOCK_DEFAULT, surface: 'header' }).map((route) => route.id);
console.assert(headerIds.includes('documents') && headerIds.includes('inbox'), 'header link ids');
console.assert(home.includes('buildSecondaryNavigation'), 'Home uses policy for secondary links');
console.assert(!fab.includes("id: 'remark'") && !fab.includes("id: 'photo'"), 'customer FAB without competing remark/photo');
console.assert(fab.includes("id: 'expense'") && fab.includes("id: 'chat'"), 'FAB keeps create expense+chat');

const std = fabActionIdsForLevel('standard', 'customer');
console.assert(Boolean(std && std.size === 2 && std.has('expense') && std.has('chat')), 'customer FAB policy = create only');

console.log('moreUnifyFab.w146.test OK');
