/** Clarity R: change-order/approvals/rooms confirms; form/filter visual SoT */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const src = (rel: string) => readFileSync(join(mobile, rel), 'utf8');

const changes = src('components/screens/estimate/EstimateChangesLayer.tsx');
const rooms = src('components/screens/OsRoomsScreen.tsx');
const roomDetail = src('components/screens/RoomDetailScreen.tsx');
const createChat = src('lib/createProjectChat.ts');
const expense = src('components/renova/ManualExpenseForm.tsx');
const approvals = src('app/approvals.tsx');
const conflicts = src('app/_stack/conflicts.tsx');
const payReturn = src('app/payment-return.tsx');
const addLine = src('components/renova/AddEstimateLineForm.tsx');
const filterBar = src('components/renova/GlobalFilterBar.tsx');
const paySheet = src('components/renova/PaymentDetailSheet.tsx');
const picker = src('components/renova/os/OsProjectPicker.tsx');
const docs = src('components/renova/DocumentsHub.tsx');
const calendar = src('components/renova/schedule/ScheduleCalendar.tsx');

if (!changes.includes("title: 'Согласовать доп. работу?'") || !changes.includes("title: 'Отклонить доп. работу?'")) {
  throw new Error('change order confirms');
}
if (!rooms.includes("title: 'Отклонить запрос?'")) throw new Error('room change reject sheet');
if (!roomDetail.includes('В архив?') || !roomDetail.includes('showActionConfirm')) {
  throw new Error('room archive sheet');
}
if (createChat.includes('Alert.alert') || !createChat.includes("title: 'Объект обязателен'")) {
  throw new Error('createProjectChat gate');
}
if (expense.includes('Alert.alert') || !expense.includes("title: 'Сумма расхода'")) {
  throw new Error('manual expense validation sheet');
}
if (!expense.includes('const busyRef = useRef(false)') || !expense.includes('if (busyRef.current || readOnly) return')) {
  throw new Error('manual expense duplicate submit guard');
}
if (!expense.includes("notifyOfflineQueued('Расход без чека')") || !expense.includes('Введённые данные сохранены в форме')) {
  throw new Error('manual expense offline/error preservation');
}
if (!expense.includes('ExpenseContextPickers') || !expense.includes('roomId') || !expense.includes('stageId')) {
  throw new Error('manual expense context links');
}
if (!approvals.includes("title: 'Отклонить согласование?'")) throw new Error('approvals reject');
if (!conflicts.includes("title: 'Удалить из очереди?'")) throw new Error('conflicts delete');
if (payReturn.includes('Alert.alert') || !payReturn.includes("primaryLabel: 'К оплатам'")) {
  throw new Error('payment-return sheet');
}

for (const [name, body] of [
  ['AddEstimateLineForm', addLine],
  ['GlobalFilterBar', filterBar],
  ['PaymentDetailSheet', paySheet],
  ['OsProjectPicker', picker],
  ['DocumentsHub', docs],
  ['ScheduleCalendar', calendar],
] as const) {
  if (!body.includes('screenTypography')) throw new Error(`${name} missing screenTypography`);
}
if (filterBar.includes("fontWeight:'700', fontSize:12")) throw new Error('GlobalFilterBar old lbl');
if (!calendar.includes('screenTypography.metricLabel')) throw new Error('calendar weekDay SoT');
if (!docs.includes('screenTypography.section')) throw new Error('docs sectionTitle SoT');

console.log('clarityWaveR.w171.test OK');
