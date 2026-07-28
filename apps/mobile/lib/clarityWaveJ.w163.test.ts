/** Clarity J: offline Alerts → notifyOfflineQueued (sheet + очередь) */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');

const screens = [
  'components/screens/OsSelectionsScreen.tsx',
  'components/renova/CreateStageSheet.tsx',
  'components/renova/CreateWorkSheet.tsx',
  'components/renova/chat/ChatThreadView.tsx',
  'components/renova/ExpenseDetailSheet.tsx',
  'components/renova/schedule/ScheduleDayDetail.tsx',
  'components/screens/ScratchpadScreen.tsx',
  'components/screens/stage/StageDetailHero.tsx',
];

for (const rel of screens) {
  const src = readFileSync(join(mobile, rel), 'utf8');
  if (!src.includes('notifyOfflineQueued')) throw new Error(`${rel}: missing notifyOfflineQueued`);
  if (src.includes("Alert.alert('Офлайн'")) throw new Error(`${rel}: still Alert Офлайн`);
}

const leftover = screens.every((rel) => {
  const src = readFileSync(join(mobile, rel), 'utf8');
  return src.includes('isOfflineQueued');
});
if (!leftover) process.exit(1);

console.log('clarityWaveJ.w163.test OK', screens.length, 'surfaces');
