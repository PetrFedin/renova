/** W148: next actions for schedule items mirror backend transitions */
import {
  nextScheduleItemActions,
  primaryScheduleItemAction,
  SCHEDULE_ITEM_STATUS_LABEL,
} from './scheduleItemNextActions';

function must(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

must(primaryScheduleItemAction('planned', 'manage') === 'ready', 'planned→ready primary');
must(primaryScheduleItemAction('in_progress', 'manage') === 'submitted', 'in_progress→submitted');
must(primaryScheduleItemAction('submitted', 'customer') === 'accepted', 'customer accept');
must(primaryScheduleItemAction('submitted', 'manage') === null, 'manage cannot accept');
must(nextScheduleItemActions('submitted', 'customer').includes('blocked'), 'customer can block');
must(!!SCHEDULE_ITEM_STATUS_LABEL.accepted, 'labels');

console.log('scheduleItemNextActions.w148.test.ts OK');
