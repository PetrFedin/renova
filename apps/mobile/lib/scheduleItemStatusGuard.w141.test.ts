/** W141: schedule accepted — contractor blocked; customer without WA blocked */
import { assertCanSetScheduleItemStatus } from './scheduleItemStatusGuard';

function must(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

must(assertCanSetScheduleItemStatus('contractor', 'accepted').ok === false, 'contractor blocked');
must(assertCanSetScheduleItemStatus('customer', 'accepted').ok === true, 'customer may call API');
must(assertCanSetScheduleItemStatus('contractor', 'submitted').ok === true, 'contractor can submit');
must(assertCanSetScheduleItemStatus('customer', 'in_progress').ok === true, 'other statuses ok');

console.log('scheduleItemStatusGuard.w141.test.ts OK');
