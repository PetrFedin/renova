/** Clarity T: portal demo/sign sheets; team-qr Pro gate; post-create/plan/week visual */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const src = (rel: string) => readFileSync(join(mobile, rel), 'utf8');

const portalRoute = src('app/portal.tsx');
const portal = src('components/screens/PortalScreen.tsx');
const teamQr = src('app/(contractor)/_screens/team-qr.tsx');
const post = src('components/renova/os/home/PostCreateSheet.tsx');
const plan = src('components/screens/object/PlanTabOverview.tsx');
const week = src('components/renova/WeekTimeline.tsx');
const chips = src('components/renova/StagePickerChips.tsx');
const setup = src('components/renova/os/home/HomeSetupChecklist.tsx');

if (portalRoute.trim() !== "export { default } from '@/components/screens/PortalScreen';") {
  throw new Error('portal route must delegate');
}
if (portal.includes("Alert.alert(\n                          'Demo-оплата'") || portal.includes("Alert.alert(\n                          'Подписано'")) {
  throw new Error('portal decision Alert left');
}
if (!portal.includes("title: 'Demo-оплата'") || !portal.includes("title: 'Подписано'")) {
  throw new Error('portal sheets missing');
}
if (!portal.includes('runPortalMutation') || !portal.includes('api.portalSignDocument')) {
  throw new Error('portal demo/sign mutations must use shared guard');
}
if (portal.includes("text: 'Продолжить demo'") || portal.includes("text: 'К оплате', onPress: goPayments")) {
  throw new Error('portal still Alert buttons');
}

if (teamQr.includes('Alert.alert') || !teamQr.includes("title: 'Бригада'")) {
  throw new Error('team-qr sheet');
}

for (const [name, body] of [
  ['PostCreateSheet', post],
  ['PlanTabOverview', plan],
  ['WeekTimeline', week],
  ['HomeSetupChecklist', setup],
] as const) {
  if (!body.includes('screenTypography')) throw new Error(`${name} missing SoT`);
}
if (!chips.includes('formSurfaceStyles') || !chips.includes('filterChipStyles')) {
  throw new Error('StagePickerChips missing shared form/chip SoT');
}
if (!chips.includes('accessibilityState={{ selected, disabled }}')) {
  throw new Error('StagePickerChips missing accessibility state');
}
if (plan.includes('...card') || plan.includes('{ ...card')) throw new Error('plan still card hero');
if (week.includes("fontWeight:'800'")) throw new Error('week old head');

console.log('clarityWaveT.w173.test OK');
