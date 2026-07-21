/** Smoke: UnifiedScheduleView не показывает «не создан» на error path */
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '../..');
const view = readFileSync(join(root, 'components/screens/schedule/UnifiedScheduleView.tsx'), 'utf8');
const api = readFileSync(join(root, 'lib/api/workSchedule.ts'), 'utf8');
const panel = readFileSync(join(root, 'components/renova/schedule/SchedulePlanPanel.tsx'), 'utf8');

const must = (c: boolean, m: string) => {
  if (!c) throw new Error(m);
};

must(view.includes('useSchedulePlanState'), 'uses schedule plan hook');
must(view.includes('SchedulePlanPanel'), 'uses plan panel');
must(view.includes("planState.status !== 'not_created'"), 'create gated on not_created');
must(!view.includes('asyncShowEmpty(scheduleRes)'), 'no async empty scheduleRes');
must(panel.includes('План работ ещё не создан'), 'honest not_created copy');
must(panel.includes('Не удалось загрузить план'), 'error copy');
must(api.includes('cacheFallback: false'), 'no silent cache as absent');
must(api.includes('fetchActiveSchedulePlan'), 'explicit fetch helper');

console.log('schedulePlanTruth.smoke.test OK');
