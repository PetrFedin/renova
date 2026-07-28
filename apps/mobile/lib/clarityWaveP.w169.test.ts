/** Clarity P: schedule/selection/expense/bank/estimate sheets; remaining uppercase */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const src = (rel: string) => readFileSync(join(mobile, rel), 'utf8');

const schedule = src('components/renova/schedule/SchedulePlanItems.tsx');
const selections = src('components/screens/OsSelectionsScreen.tsx');
const expense = src('components/renova/ExpenseDetailSheet.tsx');
const estimateDocs = src('components/screens/estimate/EstimateDocumentsLayer.tsx');
const bank = src('components/renova/BankStatementImportSheet.tsx');
const pay = src('components/renova/PaymentDetailSheet.tsx');
const confirm = src('lib/confirmAlert.ts');
const sheet = src('components/renova/ActionConfirmSheet.tsx');
const createChat = src('components/renova/chat/CreateChatSheet.tsx');
const chatThread = src('components/renova/chat/ChatThreadView.tsx');
const workSheet = src('components/renova/CreateWorkSheet.tsx');
const empty = src('components/renova/ProjectEmptyState.tsx');
const picker = src('components/renova/os/OsProjectPicker.tsx');
const room = src('components/renova/room/RoomSetupFields.tsx');
const legend = src('components/renova/estimate/EstimateSourceLegend.tsx');
const lineCard = src('components/renova/estimate/EstimateLineEditorCard.tsx');
const scratchRow = src('components/renova/scratchpad/ScratchpadLineRow.tsx');
const layout = src('constants/screenLayout.ts');

if (schedule.includes("Alert.alert(\n        'Приёмка этапа'") || schedule.includes("'Продолжить'")) {
  throw new Error('schedule still false Continue gate');
}
if (!schedule.includes("title: 'Нужна приёмка этапа'") || !schedule.includes('pushStageDetail')) {
  throw new Error('schedule acceptance CTA sheet');
}

if (selections.includes("Alert.alert('Отклонить'")) throw new Error('selection reject Alert');
if (!selections.includes("title: 'Отклонить подбор?'")) throw new Error('selection reject sheet');

if (expense.includes("Alert.alert('Удалить трату?'")) throw new Error('expense delete Alert');
if (!expense.includes("title: 'Удалить трату?'")) throw new Error('expense delete sheet');

if (estimateDocs.includes('Alert.alert(row.label')) throw new Error('estimate PDF Alert');
if (!estimateDocs.includes('showActionConfirm') || !estimateDocs.includes("label: 'Открыть'")) {
  throw new Error('estimate PDF sheet');
}

if (bank.includes('Alert.alert')) throw new Error('bank statement still Alert');
if (!bank.includes("title: 'Подтвердить оплаты?'") || !bank.includes("title: 'Расходы из выписки'")) {
  throw new Error('bank statement sheets');
}

if (pay.includes("Alert.alert('Реквизиты не указаны'")) throw new Error('payment requisites Alert');

if (!confirm.includes('showActionConfirm') || confirm.includes('Alert.alert')) {
  throw new Error('confirmDestructive still Alert');
}
if (!sheet.includes('onDismiss')) throw new Error('sheet onDismiss missing');

if (createChat.includes('Alert.alert')) throw new Error('CreateChatSheet still Alert');
if (!createChat.includes("title: 'Выберите объект'")) throw new Error('create chat gate sheet');

for (const [name, body] of [
  ['ChatThreadView', chatThread],
  ['CreateWorkSheet', workSheet],
  ['ProjectEmptyState', empty],
  ['OsProjectPicker', picker],
  ['RoomSetupFields', room],
  ['EstimateSourceLegend', legend],
  ['EstimateLineEditorCard', lineCard],
  ['ScratchpadLineRow', scratchRow],
] as const) {
  if (body.includes("textTransform: 'uppercase'")) throw new Error(`${name} still uppercase`);
  if (!body.includes('screenTypography')) throw new Error(`${name} missing screenTypography`);
}

if (layout.includes("textTransform: 'uppercase'")) throw new Error('hubSectionTitle uppercase');
if (!layout.includes('screenTypography.section')) throw new Error('hubSectionTitle SoT');

console.log('clarityWaveP.w169.test OK');
