/** A11y кнопки «Ещё»: её собственный badge относится только к задачам. */
import { formatTasks } from '../i18n';

export function moreMenuA11yLabel(taskBadge: number, _chatUnread = 0): string {
  if (taskBadge <= 0) return 'Ещё';
  return `Ещё, ${formatTasks(taskBadge)} во входящих`;
}
