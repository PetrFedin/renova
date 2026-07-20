/** W108: TAB_ALIASES in pushOsNav + inbox stage hrefs + docs offline + backend canon */
import { readFileSync } from 'fs';
import { join } from 'path';
import { TAB_ALIASES } from './legacyRoutes';
import { parseOsHref } from '../constants/osSections';
import { resolveOsDeepLink } from './osDeepLink';

const root = join(__dirname, '../../..');
const mobile = join(__dirname, '..');
const pushNav = readFileSync(join(mobile, 'lib/pushOsNav.ts'), 'utf8');
const inbox = readFileSync(join(mobile, 'lib/domain/buildInboxItems.ts'), 'utf8');
const docs = readFileSync(join(mobile, 'lib/api/documents.ts'), 'utf8');
const stageSvc = readFileSync(join(root, 'backend/app/services/stage_service.py'), 'utf8');
const purchases = readFileSync(join(root, 'backend/app/api/v1/purchases.py'), 'utf8');

console.assert(pushNav.includes('resolvePushLink'), 'pushOsNav uses resolvePushLink SoT');
console.assert(TAB_ALIASES['/(customer)/(tabs)/materials']?.includes('repair?tab=materials'), 'materials alias');
const mat = parseOsHref(TAB_ALIASES['/(customer)/(tabs)/materials']!);
console.assert(mat.pathname.includes('repair') && mat.params?.tab === 'materials', 'alias → repair materials');

const ctrl = parseOsHref(TAB_ALIASES['/(contractor)/(tabs)/control']!);
console.assert(ctrl.params?.tab === 'control', 'control alias');

console.assert(inbox.includes('`/stage/${reviewStage.id}`') || inbox.includes('/stage/${reviewStage.id}'), 'inbox accept→stage');
console.assert(inbox.includes('`/stage/${review[0].id}`') || inbox.includes('/stage/${review[0].id}'), 'await→stage');
console.assert(resolveOsDeepLink('/stage/x')?.pathname === '/stage/[id]', 'deep still works');

console.assert(docs.includes('createProjectDocument') && docs.includes('offline_queued'), 'doc create offline');
console.assert(docs.includes('archiveProjectDocument') && docs.includes('offline_queued'), 'doc archive offline');

console.assert(stageSvc.includes('repair?tab=control'), 'backend stage return_to canon');
console.assert(purchases.includes('repair?tab=materials'), 'backend purchases canon');
console.assert(!purchases.includes('/(customer)/(tabs)/materials"'), 'no bare materials path');

console.log('journeyUnify.w108.test.ts OK');
