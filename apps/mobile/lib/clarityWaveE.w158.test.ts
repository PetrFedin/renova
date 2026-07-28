/** Clarity E: Меню≠Сводка, sheet post-action, activity demote, copy */
import { readFileSync } from 'fs';
import { join } from 'path';
import { moreMenuA11yLabel } from './domain/moreMenuA11y';
import { HOME_WIDGET_STANDARD, HOME_WIDGET_PRESETS } from '../constants/homeWidgets';

const mobile = join(__dirname, '..');
const menu = readFileSync(join(mobile, 'components/renova/os/OsSectionMenu.tsx'), 'utf8');
const home = readFileSync(join(mobile, 'components/renova/os/home/HomeScreenBody.tsx'), 'utf8');
const host = readFileSync(join(mobile, 'components/renova/ActionConfirmHost.tsx'), 'utf8');
const ctx = readFileSync(join(mobile, 'lib/context/RenovaContext.tsx'), 'utf8');
const offline = readFileSync(join(mobile, 'lib/offlineUi.ts'), 'utf8');
const warranty = readFileSync(join(mobile, 'lib/warrantyNav.ts'), 'utf8');
const closeout = readFileSync(join(mobile, 'lib/scheduleCloseoutNav.ts'), 'utf8');
const widgets = readFileSync(join(mobile, 'constants/homeWidgets.ts'), 'utf8');
const i18n = readFileSync(join(mobile, 'lib/i18n.ts'), 'utf8');
const design = readFileSync(join(mobile, 'components/renova/DesignPackageList.tsx'), 'utf8');

console.assert(menu.includes('Ещё') && moreMenuA11yLabel(0) === 'Ещё', 'header Ещё');
console.assert(home.includes("title=\"Сводка\"") && home.includes("moneyZoneTitle = 'Деньги'"), 'Сводка≠Деньги');
console.assert(host.includes('ActionConfirmSheet') && ctx.includes('ActionConfirmHost'), 'host wired');
console.assert(offline.includes('showActionConfirm') && !offline.includes('Alert.alert'), 'offline sheet');
console.assert(warranty.includes('showActionConfirm') && closeout.includes('showActionConfirm'), 'nav sheets');
console.assert(!HOME_WIDGET_STANDARD.includes('activity'), 'standard no activity');
console.assert(HOME_WIDGET_PRESETS.detailed.ids.includes('activity'), 'detailed keeps activity');
console.assert(widgets.includes('в блоке «Сводка»'), 'activity hint Сводка');
console.assert(i18n.includes('Напишите владельцу в чат'), 'readOnly next step');
console.assert(design.includes("'+ Загрузить PDF'"), 'design contractor CTA');

const ok =
  moreMenuA11yLabel(0) === 'Ещё' &&
  !HOME_WIDGET_STANDARD.includes('activity') &&
  offline.includes('showActionConfirm');
if (!ok) process.exit(1);
console.log('clarityWaveE.w158.test OK');
