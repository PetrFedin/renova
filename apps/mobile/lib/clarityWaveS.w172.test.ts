/** Clarity S: estimate lock/reject/withdraw confirms; approvals approve; wizard; home visual */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const src = (rel: string) => readFileSync(join(mobile, rel), 'utf8');

const summary = src('components/screens/estimate/EstimateSummaryLayer.tsx');
const approvals = src('app/approvals.tsx');
const wizard = src('app/wizard/_screens/confirm.tsx');
const floors = src('components/renova/RoomFloorGroups.tsx');
const banner = src('components/renova/os/home/HomeAcceptanceBanner.tsx');
const kpi = src('components/renova/os/home/HomeKpiDetailSheet.tsx');

if (summary.includes('Alert.alert')) throw new Error('estimate summary still Alert');
for (const title of [
  "title: 'Зафиксировать смету?'",
  "title: 'Отклонить смету?'",
  "title: 'Отозвать предложение?'",
]) {
  if (!summary.includes(title)) throw new Error(`missing ${title}`);
}
if (summary.includes('totals.grandTotal')) throw new Error('wrong totals field');

if (!approvals.includes("title: 'Согласовать?'")) throw new Error('approvals approve sheet');
if (!approvals.includes("title: 'Отклонить согласование?'")) throw new Error('approvals reject sheet');

if (wizard.includes('Alert.alert') || wizard.includes('Alert.')) throw new Error('wizard still Alert');
if (!wizard.includes("title: 'Ошибка создания'") || !wizard.includes("title: 'Название'")) {
  throw new Error('wizard sheets');
}

if (!floors.includes('screenTypography') || floors.includes('🏠')) throw new Error('floor header SoT');
if (!banner.includes('screenTypography.listTitle')) throw new Error('acceptance banner SoT');
if (!kpi.includes('screenTypography') || !kpi.includes('listRowStyles')) throw new Error('kpi sheet SoT');

console.log('clarityWaveS.w172.test OK');
