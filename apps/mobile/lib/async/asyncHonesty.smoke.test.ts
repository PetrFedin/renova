/**
 * Smoke: критичные экраны не маскируют ошибку через .catch(() => []).
 * Run: npx tsx apps/mobile/lib/async/asyncHonesty.smoke.test.ts
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '../..');
const must = (cond: boolean, msg: string) => {
  if (!cond) throw new Error(msg);
};

function read(rel: string) {
  return readFileSync(join(root, rel), 'utf8');
}

const files = [
  'components/screens/OsSelectionsScreen.tsx',
  'components/screens/schedule/UnifiedScheduleView.tsx',
  'components/renova/os/WeekScheduleStrip.tsx',
  'components/screens/control/ContractorControlView.tsx',
  'components/screens/control/CustomerControlView.tsx',
  'app/approvals.tsx',
  'components/renova/WorkOrdersListPanel.tsx',
  'components/renova/ActivityFeed.tsx',
  'lib/useTodayTaskCount.ts',
];

for (const f of files) {
  const src = read(f);
  must(!src.includes('.catch(() => [])'), `${f}: no catch empty array`);
  must(!src.includes('.catch(() => null)'), `${f}: no catch null`);
  must(src.includes('useAsyncResource') || src.includes('AsyncResource') || src.includes('InlineError') || f.includes('useTodayTaskCount'), `${f}: uses honesty pattern`);
}

must(read('components/screens/schedule/UnifiedScheduleView.tsx').includes('Не удалось загрузить план-график'), 'schedule error copy');
must(read('components/screens/OsSelectionsScreen.tsx').includes('Не удалось загрузить подбор'), 'selections error copy');
must(read('lib/useTodayTaskCount.ts').includes('reliable'), 'today tasks reliable');

// UI primitives exist
for (const ui of [
  'components/async/InlineError.tsx',
  'components/async/StaleDataBanner.tsx',
  'components/async/RetryButton.tsx',
  'components/async/EmptyState.tsx',
  'components/async/LoadingSkeleton.tsx',
]) {
  must(read(ui).length > 50, ui);
}

console.log('asyncHonesty.smoke.test OK');
