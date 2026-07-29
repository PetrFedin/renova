/** Clarity U: nested confirm fix; portal/app decision gaps; KPI/expense SoT */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const src = (rel: string) => readFileSync(join(mobile, rel), 'utf8');

const sheet = src('components/renova/ActionConfirmSheet.tsx');
if (!sheet.includes('queueMicrotask') || !sheet.includes('runThenClose')) {
  throw new Error('ActionConfirmSheet must defer actions after close (nested sheets)');
}

const portalRoute = src('app/portal.tsx');
const portal = src('components/screens/PortalScreen.tsx');
if (portalRoute.trim() !== "export { default } from '@/components/screens/PortalScreen';") {
  throw new Error('portal route must delegate');
}
for (const copy of [
  'Согласовать график?',
  'Принять этап?',
  'Согласовать доп. работу?',
  'Зафиксировать смету?',
]) {
  if (!portal.includes(copy)) throw new Error(`portal missing ${copy}`);
}
if (portal.includes("Alert.alert('Согласовано'") || portal.includes("Alert.alert('Готово', 'Смета зафиксирована')")) {
  throw new Error('portal still uses Alert for CO/lock success');
}
if (!portal.includes('confirmMutation') || !portal.includes('showActionConfirm')) {
  throw new Error('portal approvals must use shared confirmation orchestration');
}

const schedule = src('components/screens/schedule/UnifiedScheduleView.tsx');
if (!schedule.includes("title: 'Согласовать график?'")) {
  throw new Error('schedule approve confirm missing');
}

const contractorEst = src('components/screens/estimate/ContractorEstimateView.tsx');
if (!contractorEst.includes("title: 'Отозвать предложение?'")) {
  throw new Error('contractor withdraw confirm missing');
}

const acceptance = src('components/renova/UnifiedAcceptanceList.tsx');
if (!acceptance.includes("title: 'Принять этап?'") || !acceptance.includes("title: 'Вернуть на доработку?'")) {
  throw new Error('acceptance pre-confirm missing');
}

const design = src('components/renova/DesignPackageList.tsx');
if (!design.includes("title: 'Согласовать дизайн?'") || !design.includes('screenTypography')) {
  throw new Error('design approve sheet / SoT');
}

const leads = src('components/renova/JobLeadsBoard.tsx');
if (!leads.includes("title: 'Принять КП?'") || !leads.includes("title: 'Авто-назначить?'")) {
  throw new Error('job lead confirms missing');
}

const widgets = src('components/renova/os/OsWidgetStrip.tsx');
if (!widgets.includes('listRowStyles.metricCell') || widgets.includes('...card')) {
  throw new Error('OsWidgetStrip still Theme.card');
}

for (const [name, rel] of [
  ['ExpenseByRoom', 'components/renova/ExpenseByRoom.tsx'],
  ['ExpenseByStage', 'components/renova/ExpenseByStage.tsx'],
  ['ExpenseByCategory', 'components/renova/ExpenseByCategory.tsx'],
  ['ExpenseByFloor', 'components/renova/ExpenseByFloor.tsx'],
] as const) {
  const body = src(rel);
  if (!body.includes('screenTypography')) throw new Error(`${name} missing SoT`);
  if (body.includes("fontWeight: '800'")) throw new Error(`${name} still 800 head`);
}

console.log('clarityWaveU.w174.test OK');
