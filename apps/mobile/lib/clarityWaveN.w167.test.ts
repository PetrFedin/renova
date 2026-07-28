/** Clarity N: closeout/acceptance sheets; settings/widget uppercase cleanup */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const src = (rel: string) => readFileSync(join(mobile, rel), 'utf8');

const docs = src('components/renova/DocumentsHub.tsx');
const accept = src('components/renova/UnifiedAcceptanceList.tsx');
const stage = src('components/screens/StageDetailScreen.tsx');
const hero = src('components/screens/stage/StageDetailHero.tsx');
const homeWidgets = src('components/renova/os/HomeWidgetSettings.tsx');
const dock = src('components/renova/os/DockBarSettings.tsx');
const strip = src('components/renova/os/OsWidgetStrip.tsx');
const workForm = src('components/renova/work/WorkFormSection.tsx');
const guide = src('components/screens/object/ObjectTabGuide.tsx');
const expenseTbl = src('components/renova/ExpenseDetailTable.tsx');
const mgr = src('components/screens/ManagerDashboardScreen.tsx');
const passport = src('components/renova/os/RoomPassport.tsx');
const roomTl = src('components/renova/os/RoomStageTimeline.tsx');

if (docs.includes("Alert.alert('Ещё не готово'") || docs.includes("Alert.alert('Завершить объект?'")) {
  throw new Error('closeout still Alert');
}
if (docs.includes("Alert.alert(\n              'Открытые гарантии'")) throw new Error('warranty still Alert');
if (!docs.includes("title: 'Ещё не готово'") || !docs.includes("title: 'Завершить объект?'")) {
  throw new Error('closeout sheet missing');
}

if (accept.includes("Alert.alert('Нужен чек-лист'")) throw new Error('acceptance checklist Alert');
if (!accept.includes("title: 'Нужен чек-лист'")) throw new Error('acceptance sheet');

if (stage.includes("Alert.alert(\n        'Принять без чеклиста?'")) throw new Error('stage accept Alert');
// Clarity V: всегда confirm; empty checklist — ветка «Принять без чеклиста?»
if (!stage.includes("'Принять без чеклиста?'") || !stage.includes("'Принять этап?'")) {
  throw new Error('stage accept sheet');
}

if (hero.includes("Alert.alert('Блокировка'") || hero.includes("Alert.alert(\n                    'Нужен договор'")) {
  throw new Error('hero still Alert gates');
}
if (!hero.includes("title: 'Нужен договор'")) throw new Error('hero contract sheet');

for (const [name, body] of [
  ['HomeWidgetSettings', homeWidgets],
  ['DockBarSettings', dock],
  ['OsWidgetStrip', strip],
  ['WorkFormSection', workForm],
  ['ObjectTabGuide', guide],
  ['ExpenseDetailTable', expenseTbl],
  ['ManagerDashboard', mgr],
  ['RoomPassport', passport],
  ['RoomStageTimeline', roomTl],
] as const) {
  if (body.includes("textTransform: 'uppercase'")) throw new Error(`${name} still uppercase`);
  if (!body.includes('screenTypography') && !body.includes('listRowStyles')) {
    throw new Error(`${name} missing typography tokens`);
  }
}

console.log('clarityWaveN.w167.test OK');
