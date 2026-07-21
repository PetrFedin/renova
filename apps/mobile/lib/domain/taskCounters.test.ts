/**
 * Unit: TaskCounters SoT — revision, delta, badge semantics.
 * Run: npx tsx apps/mobile/lib/domain/taskCounters.test.ts
 */
import {
  TASK_COUNTER_BADGE,
  applyTaskCounterDelta,
  emptyTaskCounters,
  shouldApplyTaskCounters,
  taskCountersContextKey,
  type TaskCounters,
} from './taskCounters';

const must = (c: boolean, m: string) => {
  if (!c) throw new Error(m);
};

const base: TaskCounters = emptyTaskCounters({
  dueToday: 2,
  overdue: 1,
  upcoming: 3,
  actionRequired: 2,
  byType: { calendar: 2, overdue: 1, payment: 1, acceptance: 0 },
  revision: 100,
});

// Stale response drop
must(!shouldApplyTaskCounters(base, { ...base, revision: 99 }), 'drop older revision');
must(shouldApplyTaskCounters(base, { ...base, revision: 100 }), 'equal ok');
must(shouldApplyTaskCounters(base, { ...base, revision: 101 }), 'newer ok');
must(shouldApplyTaskCounters(null, base), 'null current always apply');

// Duplicate / stale delta ignored
must(applyTaskCounterDelta(base, { revision: 100, counter_delta: { payment: -1 } }) === base, 'same rev ignore');
must(applyTaskCounterDelta(base, { revision: 99, counter_delta: { payment: -1 } }) === base, 'older rev ignore');

// Apply newer delta
const next = applyTaskCounterDelta(base, {
  revision: 110,
  counter_delta: { calendar: -1, overdue: -1, payment: -1 },
});
must(!!next, 'delta applied');
must(next!.dueToday === 1, `dueToday after delta got ${next!.dueToday}`);
must(next!.overdue === 0, `overdue after delta got ${next!.overdue}`);
must(next!.revision === 110, 'revision bumped');
must(next!.actionRequired === 0, `actionRequired got ${next!.actionRequired}`);

// Badge semantics locked
must(TASK_COUNTER_BADGE.calendar === 'dueToday', 'calendar = dueToday');
must(TASK_COUNTER_BADGE.inboxTasks === 'actionRequired', 'inbox = actionRequired');
must(TASK_COUNTER_BADGE.overdueSeparate === true, 'overdue separate');

// Context key includes project + role + tz (project switch / role / timezone)
const k1 = taskCountersContextKey('p1', 'customer', 'Europe/Moscow');
const k2 = taskCountersContextKey('p2', 'customer', 'Europe/Moscow');
const k3 = taskCountersContextKey('p1', 'contractor', 'Europe/Moscow');
const k4 = taskCountersContextKey('p1', 'customer', 'Asia/Tokyo');
must(k1 !== k2, 'project switch changes key');
must(k1 !== k3, 'role switch changes key');
must(k1 !== k4, 'timezone switch changes key');

console.log('taskCounters.test OK');
