/** Clarity O: settings/scratchpad sheets; chat/filter/search/budget uppercase cleanup */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const src = (rel: string) => readFileSync(join(mobile, rel), 'utf8');

const dock = src('components/renova/os/DockBarSettings.tsx');
const widgets = src('components/renova/os/HomeWidgetSettings.tsx');
const scratch = src('components/screens/ScratchpadScreen.tsx');
const createChat = src('components/renova/chat/CreateChatSheet.tsx');
const filter = src('components/renova/FilterDropdown.tsx');
const chatTask = src('components/renova/chat/ChatTaskSheet.tsx');
const search = src('components/renova/GlobalSearchBar.tsx');
const chatFilter = src('components/renova/chat/ChatProjectFilter.tsx');
const period = src('components/renova/BudgetPeriodPicker.tsx');
const sites = src('components/renova/ProjectSitesPanel.tsx');
const menu = src('components/renova/os/OsSectionMenu.tsx');
const periodDetail = src('components/screens/budget/BudgetPeriodDetailSection.tsx');
const guide = src('components/screens/GuideScreen.tsx');
const portfolio = src('components/renova/os/portfolio/PortfolioSummaryHero.tsx');
const estFilter = src('components/renova/estimate/EstimateFilterBar.tsx');

if (dock.includes('Alert.alert')) throw new Error('DockBarSettings still Alert');
if (!dock.includes("title: 'Обязательно'") || !dock.includes('showActionConfirm')) {
  throw new Error('dock gate sheet');
}

if (widgets.includes('Alert.alert')) throw new Error('HomeWidgetSettings still Alert');
if (!widgets.includes("title: 'Минимум один'")) throw new Error('widget min sheet');

if (scratch.includes("Alert.alert('Удалить строку?'")) throw new Error('scratch delete Alert');
if (!scratch.includes("title: 'Удалить строку?'")) throw new Error('scratch delete sheet');

for (const [name, body] of [
  ['CreateChatSheet', createChat],
  ['FilterDropdown', filter],
  ['ChatTaskSheet', chatTask],
  ['GlobalSearchBar', search],
  ['ChatProjectFilter', chatFilter],
  ['BudgetPeriodPicker', period],
  ['ProjectSitesPanel', sites],
  ['OsSectionMenu', menu],
  ['BudgetPeriodDetailSection', periodDetail],
  ['GuideScreen', guide],
  ['PortfolioSummaryHero', portfolio],
  ['EstimateFilterBar', estFilter],
] as const) {
  if (body.includes("textTransform: 'uppercase'")) throw new Error(`${name} still uppercase`);
  if (!body.includes('screenTypography')) throw new Error(`${name} missing screenTypography`);
}

console.log('clarityWaveO.w168.test OK');
