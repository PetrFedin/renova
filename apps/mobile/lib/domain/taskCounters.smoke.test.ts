/**
 * Smoke: счётчики задач — единый SoT, семантика badge, timezone.
 * Run: npx tsx apps/mobile/lib/domain/taskCounters.smoke.test.ts
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '../..');
const must = (c: boolean, m: string) => {
  if (!c) throw new Error(m);
};
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

must(read('lib/api/tasks.ts').includes('/api/v1/tasks/counters'), 'API client counters path');
must(read('lib/taskCountersStore.ts').includes('handleTaskUpdatedEvent'), 'store handles task.updated');
must(read('lib/taskCountersStore.ts').includes('reconcileTaskCounters'), 'store reconcile');
must(read('lib/domain/taskCounters.ts').includes("calendar: 'dueToday'"), 'badge calendar=dueToday');
must(read('lib/domain/taskCounters.ts').includes("inboxTasks: 'actionRequired'"), 'badge inbox=actionRequired');

const dock = read('components/renova/os/OsDockBar.tsx');
must(dock.includes("id === 'calendar'") && dock.includes('todayTasks'), 'calendar uses dueToday');
must(!dock.includes("id === 'home' && !items.includes('calendar')"), 'no silent dueToday→home transfer');
must(dock.includes('overdueDot') || dock.includes('overdueTasks'), 'overdue separate visual');

const hook = read('lib/useTodayTaskCount.ts');
must(hook.includes('getDeviceTimezone'), 'timezone from device');
must(hook.includes('reliable'), 'reliable flag for honesty');
must(!hook.includes("toISOString().slice(0, 10)"), 'no UTC-only today');

const ws = read('lib/inboxSyncStore.ts');
must(ws.includes('task.updated'), 'WS routes task.updated');
must(ws.includes('handleTaskUpdatedEvent'), 'WS → taskCountersStore');

const inbox = read('lib/useChatUnread.ts');
must(inbox.includes('useActionRequiredCount'), 'inbox tasks from actionRequired SoT');

console.log('taskCounters.smoke.test OK');
