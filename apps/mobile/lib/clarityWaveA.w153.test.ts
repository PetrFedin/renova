/** Clarity A: lean home both roles, Сводка, hub ≤2 primary, dismissible guide */
import { readFileSync } from 'fs';
import { join } from 'path';
import { budgetHubTabsForRole } from '../constants/budgetTabs';

const mobile = join(__dirname, '..');
const home = readFileSync(join(mobile, 'components/renova/os/home/HomeScreenBody.tsx'), 'utf8');
const more = readFileSync(join(mobile, 'components/renova/os/HomeMoreSection.tsx'), 'utf8');
const objectHub = readFileSync(join(mobile, 'components/screens/OsObjectHubScreen.tsx'), 'utf8');
const repair = readFileSync(join(mobile, 'components/screens/OsRepairHubScreen.tsx'), 'utf8');
const guide = readFileSync(join(mobile, 'components/screens/object/ObjectTabGuide.tsx'), 'utf8');
const planOv = readFileSync(join(mobile, 'components/screens/object/PlanTabOverview.tsx'), 'utf8');

console.assert(
  home.includes("showAttention && phase !== 'complete'") && home.includes('<HomeActionHero'),
  'lean both roles',
);
console.assert(home.includes('title="Сводка"') || more.includes("title = 'Сводка'"), 'Home Сводка not Ещё');
console.assert(more.includes('Сводка') && !more.includes("`Ещё ·"), 'HomeMoreSection Сводка');
console.assert(objectHub.includes('secondary: true') && objectHub.includes('OsHubTabs'), 'object hub progressive');
console.assert(repair.includes('secondary: true') && !repair.includes('leanCustomer'), 'repair lean both');
console.assert(guide.includes('dismissKey') && guide.includes('Скрыть'), 'guide dismissible');
console.assert(!planOv.includes('Как это работает') && planOv.includes('heroStatus'), 'plan overview compact');

const cust = budgetHubTabsForRole('customer');
const contr = budgetHubTabsForRole('contractor');
console.assert(cust.filter((t) => t.secondary).length === 2, 'customer budget secondary');
console.assert(contr.filter((t) => t.secondary).length === 2, 'contractor budget secondary');

const ok =
  home.includes("showAttention && phase !== 'complete'") &&
  home.includes('<HomeActionHero') &&
  more.includes('Сводка') &&
  objectHub.includes('OsHubTabs') &&
  guide.includes('Скрыть');
if (!ok) process.exit(1);
console.log('clarityWaveA.w153.test OK');
