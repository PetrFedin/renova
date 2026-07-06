import assert from 'node:assert/strict';
import { buildScheduleExecutionStats } from './scheduleExecutionStats';

const today = '2026-07-06';
const stats = buildScheduleExecutionStats(
  [
    {
      id: '1',
      status: 'published',
      planned_start: '2026-07-06',
      planned_end: '2026-07-06',
      notes: '',
      updated_at: '2026-07-06T10:00:00',
    } as any,
    {
      id: '2',
      status: 'done',
      planned_start: '2026-07-01',
      planned_end: '2026-07-05',
      notes: 'Продление срока заказчиком',
      updated_at: '2026-07-05T12:00:00',
    } as any,
    {
      id: '3',
      status: 'in_progress',
      planned_start: '2026-06-20',
      planned_end: '2026-07-01',
      notes: '',
      updated_at: '2026-07-01T12:00:00',
    } as any,
  ],
  today,
);

assert.equal(stats.todayOpen, 1);
assert.equal(stats.overdue, 1);
assert.equal(stats.doneThisWeek >= 1, true);
assert.equal(stats.extensions, 1);

console.log('scheduleExecutionStats.test OK');
