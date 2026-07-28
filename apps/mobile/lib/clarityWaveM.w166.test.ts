/** Clarity M: ActionConfirm actions[]; Docs/Chat/Payment sheets; visual leftovers */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const src = (rel: string) => readFileSync(join(mobile, rel), 'utf8');

const bus = src('lib/actionConfirmBus.ts');
const sheet = src('components/renova/ActionConfirmSheet.tsx');
const host = src('components/renova/ActionConfirmHost.tsx');
const docs = src('components/renova/DocumentsHub.tsx');
const chatList = src('components/renova/chat/ChatListView.tsx');
const chatThread = src('components/renova/chat/ChatThreadView.tsx');
const pay = src('components/renova/PaymentDetailSheet.tsx');
const works = src('components/screens/OsWorksScreen.tsx');
const timeline = src('components/renova/RepairProcessTimeline.tsx');
const budgetTabs = src('constants/budgetTabs.ts');
const widgets = src('constants/homeWidgets.ts');
const analytics = src('components/renova/ProjectAnalyticsPanel.tsx');
const guide = src('components/screens/object/ObjectTabGuide.tsx');
const scratch = src('components/screens/ScratchpadScreen.tsx');
const selections = src('components/screens/OsSelectionsScreen.tsx');
const alerts = src('components/renova/BudgetAlerts.tsx');
const matrix = src('components/renova/StageRoomMatrix.tsx');

if (!bus.includes('actions?:') || !sheet.includes('actions?:')) throw new Error('actions[] missing');
if (!host.includes('actions={payload?.actions}')) throw new Error('host actions wiring');

if (docs.includes("Alert.alert(row.label") || docs.includes("Alert.alert('Загрузить документ'")) {
  throw new Error('docs still Alert menus');
}
if (!docs.includes('openPdfMenu') || !docs.includes('actions:')) throw new Error('docs pdf sheet');

if (chatList.includes('Alert.alert(t.title')) throw new Error('chat list long-press Alert');
if (!chatList.includes('showActionConfirm')) throw new Error('chat list sheet');

if (chatThread.includes("Alert.alert('Сообщение'") || chatThread.includes("Alert.alert('Счёт в бюджете'")) {
  throw new Error('chat thread Alert menus');
}
if (pay.includes("Alert.alert(\n      'Чек'") || pay.includes("Alert.alert(\n      'Перевод'")) {
  throw new Error('payment still Alert CTA');
}
if (!pay.includes("title: 'Чек'") || !pay.includes('showActionConfirm')) throw new Error('payment sheet CTA');

if (works.includes('<RepairProcessTimeline') && !works.includes('showSecondaryPanels')) {
  throw new Error('timeline still always first viewport');
}
const timelineBeforeFilters = works.indexOf('RepairProcessTimeline') < works.indexOf('SearchFilter');
if (timelineBeforeFilters) throw new Error('timeline should be behind secondary, not before filters');

if (!timeline.includes('listRowStyles') || timeline.includes('...card')) throw new Error('timeline visual');
if (!budgetTabs.includes("label: 'План–факт'")) throw new Error('budget tab rename');
if (widgets.includes('Сводка:')) throw new Error('widgets still Сводка:');
if (!analytics.includes('План и факт')) throw new Error('analytics title');
if (guide.includes('Сводка объекта')) throw new Error('object guide Сводка');
if (!scratch.includes('LoadErrorState') || !scratch.includes('showActionConfirm')) throw new Error('scratchpad');
if (!selections.includes('listRowStyles') || selections.includes('addBox: { ...card')) throw new Error('selections');
if (!alerts.includes('listRowStyles') || !matrix.includes('listRowStyles')) throw new Error('alerts/matrix');

console.log('clarityWaveM.w166.test OK');
