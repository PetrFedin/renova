/** W119: navigation helpers + chat/search/push/layout → pushOsNav SoT */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');

const files: Record<string, string> = {
  nav: 'lib/navigation.ts',
  osTab: 'lib/osTabNav.ts',
  chat: 'components/renova/chat/ChatThreadView.tsx',
  search: 'components/renova/GlobalSearchBar.tsx',
  fab: 'components/renova/os/OsQuickFab.tsx',
  accept: 'lib/acceptanceNav.ts',
  leads: 'components/renova/JobLeadsBoard.tsx',
  layout: 'app/_layout.tsx',
  ctx: 'lib/context/RenovaContext.tsx',
  teamQr: 'app/(contractor)/_screens/team-qr.tsx',
};

const src: Record<string, string> = {};
for (const [k, rel] of Object.entries(files)) {
  src[k] = readFileSync(join(mobile, rel), 'utf8');
}

function noRawPush(name: string, body: string) {
  // комментарии с текстом router.push допустимы только в navigation.ts docstring
  const lines = body.split('\n').filter((l) => l.includes('router.push') && !l.trim().startsWith('*') && !l.trim().startsWith('//'));
  console.assert(lines.length === 0, `${name}: raw router.push — ${lines[0] || ''}`);
}

for (const [k, body] of Object.entries(src)) noRawPush(k, body);

console.assert(src.nav.includes("pushOsNav({ pathname: '/stage/[id]'"), 'nav stage SoT');
console.assert(src.nav.includes("pushOsNav({ pathname: '/material/[id]'"), 'nav material SoT');
console.assert(src.nav.includes('pushOsNav({ pathname: path, params }'), 'nav pushScreen SoT');
console.assert(src.osTab.includes('pushOsNav(href, returnTo, role)'), 'osTab href→pushOsNav');
console.assert(src.chat.includes("pathname: '/work-order/[id]'") && src.chat.includes('osRole={role}'), 'chat WO SoT');
console.assert(src.chat.includes("budgetTabRoute('contractor', 'payments')"), 'chat invoice→payments');
console.assert(src.search.includes("pathname: '/chat/[threadId]'") && src.search.includes('pushOsNav'), 'search chat SoT');
console.assert(src.fab.includes("pathname: '/scratchpad'"), 'fab scratchpad SoT');
console.assert(src.accept.includes("budgetTabRoute") && src.accept.includes('pushOsNav'), 'accept→pay SoT');
console.assert(src.leads.includes('pushOsNav') && src.leads.includes('replaceOsNav'), 'leads SoT');
console.assert(src.layout.includes('pushOsNav(link, returnTo'), 'layout push SoT');
console.assert(src.ctx.includes("pushOsNav('/(contractor)/subscription'"), 'ctx subscription SoT');
console.assert(src.teamQr.includes("pushOsNav('/(contractor)/subscription'"), 'teamQr subscription SoT');

console.log('journeyUnify.w119.test.ts OK');
