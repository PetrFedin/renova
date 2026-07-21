/** W120: payment-return/entry/tabs replace → pushOsNav/replaceOsNav SoT */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');

const files: Record<string, string> = {
  payReturn: 'app/payment-return.tsx',
  material: 'app/material/[id].tsx',
  leadWiz: 'app/contractor-wizard/[leadId].tsx',
  empty: 'components/renova/ProjectEmptyState.tsx',
  repair: 'components/screens/OsRepairHubScreen.tsx',
  ctx: 'lib/context/RenovaContext.tsx',
  rooms: 'app/wizard/_screens/rooms.tsx',
  entry: 'lib/osEntry.ts',
  role: 'components/renova/RoleSwitchButton.tsx',
  tabsShell: 'components/renova/os/OsTabsLayoutOptions.tsx',
  more: 'components/renova/os/OsSectionMenu.tsx',
  crumbs: 'components/renova/os/OsHeaderBreadcrumb.tsx',
};

const src: Record<string, string> = {};
for (const [k, rel] of Object.entries(files)) {
  src[k] = readFileSync(join(mobile, rel), 'utf8');
}

function noRawReplace(name: string, body: string) {
  const lines = body.split('\n').filter(
    (l) =>
      (l.includes('router.replace') || l.includes('router.push')) &&
      !l.trim().startsWith('*') &&
      !l.trim().startsWith('//') &&
      !l.includes('router.back'),
  );
  console.assert(lines.length === 0, `${name}: raw router — ${lines[0] || ''}`);
}

for (const [k, body] of Object.entries(src)) noRawReplace(k, body);

console.assert(src.payReturn.includes("budgetTabRoute('customer', 'payments')"), 'YuKassa→payments tab');
console.assert(src.payReturn.includes('replaceOsNav'), 'payment-return SoT');
console.assert(src.material.includes("repairTabRoute(role, 'materials')"), 'material→materials hub');
console.assert(src.leadWiz.includes("tabsRoute('contractor', 'index')"), 'lead wizard→home');
console.assert(src.empty.includes("replaceOsNav(tabsRoute(role, 'index')"), 'empty→home SoT');
console.assert(src.repair.includes("replaceOsNav(tabsRoute(role, 'calendar')"), 'repair calendar redirect');
console.assert(src.ctx.includes("replaceOsNav('/(contractor)/subscription'"), 'paywall→subscription');
console.assert(src.rooms.includes("pushOsNav('/wizard/confirm')"), 'wizard rooms→confirm');
console.assert(src.entry.includes("replaceOsNav('/onboarding/detail-quiz')"), 'login→quiz SoT');
console.assert(src.entry.includes('replaceOsNav(projectPickRoute())'), 'login→project pick SoT');
console.assert(src.role.includes("replaceOsNav('/onboarding/role')"), 'role switch SoT');
console.assert(src.tabsShell.includes('replaceOsNav(projectPickRoute())'), 'pending pick SoT');
console.assert(src.more.includes('replaceOsNav(tabsRoute(menuRole'), 'more sections SoT');
console.assert(src.crumbs.includes('replaceOsNav(crumbHref') && src.crumbs.includes('replaceOsNav(hubCrumbRoute'), 'crumbs SoT');

console.log('journeyUnify.w120.test.ts OK');
