/** W107: deep-link nav + estimate/stage offline field mutations */
import { readFileSync } from 'fs';
import { join } from 'path';
import { resolveOsDeepLink } from './osDeepLink';

const mobile = join(__dirname, '..');
const estimate = readFileSync(join(mobile, 'lib/api/estimate.ts'), 'utf8');
const stages = readFileSync(join(mobile, 'lib/api/stages.ts'), 'utf8');
const pushNav = readFileSync(join(mobile, 'lib/pushOsNav.ts'), 'utf8');
const deepSrc = readFileSync(join(mobile, 'lib/osDeepLink.ts'), 'utf8');
const banner = readFileSync(join(mobile, 'components/renova/os/home/HomeAcceptanceBanner.tsx'), 'utf8');
const osTab = readFileSync(join(mobile, 'lib/osTabNav.ts'), 'utf8');

const stage = resolveOsDeepLink('/stage/abc-123', '/home');
console.assert(stage?.pathname === '/stage/[id]' && stage.params?.id === 'abc-123', 'stage deep link');
console.assert(stage?.params?.returnTo === '/home', 'stage returnTo');

const chat = resolveOsDeepLink('/chat/t1', '/inbox');
console.assert(chat?.pathname === '/chat/[threadId]' && chat.params?.threadId === 't1', 'chat deep link');

const wo = resolveOsDeepLink('/work-order/w9', '/x');
console.assert(wo?.pathname === '/work-order/[id]' && wo.params?.id === 'w9', 'work-order deep');

console.assert(!resolveOsDeepLink('/(customer)/(tabs)/repair?tab=control'), 'tabs not deep');
console.assert(pushNav.includes('resolveOsDeepLink'), 'pushOsNav uses resolve');
console.assert(deepSrc.includes('/stage/[id]'), 'osDeepLink canon');
console.assert(osTab.includes('resolveOsDeepLink'), 'osTabNav uses resolve');

console.assert(estimate.includes('createChangeOrder') && estimate.includes('offline_queued'), 'CO offline');
console.assert(estimate.includes('patchEstimateLine') && estimate.includes('estimate/lines'), 'patch offline');
console.assert(estimate.includes('addEstimateLine') && estimate.includes('offline_queued'), 'add line offline');
console.assert(stages.includes("stages/${stageId}/ready") && stages.includes('offline_queued'), 'ready offline');
console.assert(banner.includes('href') && banner.includes('pushOsNav'), 'banner href');

console.log('journeyUnify.w107.test.ts OK');
