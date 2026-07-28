/** Clarity Q: portal/schedule/budget confirms; decision history + budget detail visual */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const src = (rel: string) => readFileSync(join(mobile, rel), 'utf8');

const portal = src('app/portal.tsx');
const schedule = src('components/screens/schedule/UnifiedScheduleView.tsx');
const budget = src('app/_stack/budget-planner.tsx');
const home = src('components/renova/os/home/HomeCompletionStrip.tsx');
const qc = src('components/screens/QualityControlScreen.tsx');
const decisions = src('components/renova/DecisionHistoryPanel.tsx');
const periodDetail = src('components/screens/budget/BudgetPeriodDetailSection.tsx');

if (!portal.includes('showActionConfirm')) throw new Error('portal missing showActionConfirm');
for (const title of [
  "title: 'На доработку?'",
  "title: 'Отклонить график?'",
  "title: 'Этап принят'",
  "title: 'Нужен чек-лист'",
  "title: 'Отклонить доп. работу?'",
  "title: 'Отклонить смету?'",
]) {
  if (!portal.includes(title)) throw new Error(`portal missing ${title}`);
}
if (portal.includes('await api.portalReturnStage') && portal.includes("onPress={async () => {\n                    try {\n                      await api.portalReturnStage")) {
  throw new Error('portal return still one-tap');
}

if (schedule.includes('Alert.prompt?.') || schedule.includes("Alert.alert('Отклонить график?'")) {
  throw new Error('schedule reject still Alert');
}
if (!schedule.includes("title: 'Отклонить график?'")) throw new Error('schedule reject sheet');

if (budget.includes('Alert.alert')) throw new Error('budget planner still Alert');
if (!budget.includes("title: 'Применить к плану?'")) throw new Error('budget apply sheet');

if (home.includes('Alert.alert') || home.includes('Alert.')) throw new Error('home completion still Alert');
if (!home.includes("title: 'Дайджест'")) throw new Error('digest sheet');

if (qc.includes("Alert.alert('Спор'")) throw new Error('QC escalate Alert');
if (!qc.includes("title: 'Спор'")) throw new Error('QC escalate sheet');

if (decisions.includes("textTransform: 'uppercase'")) throw new Error('decision badge uppercase');
if (!decisions.includes('screenTypography') || !decisions.includes('listRowStyles')) {
  throw new Error('decision visual SoT');
}

if (periodDetail.includes('...card') || periodDetail.includes('{ ...card')) {
  throw new Error('period detail still card wrap');
}
if (!periodDetail.includes('listRowStyles.metricCell')) throw new Error('period detail metricCell');

console.log('clarityWaveQ.w170.test OK');
