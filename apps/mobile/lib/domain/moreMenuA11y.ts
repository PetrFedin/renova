/** A11y кнопки «Ещё»: её собственный badge относится только к задачам. */
import { formatTasks } from '../i18n/ruCountLabels';

/**
 * Chat unread намеренно не входит в label кнопки «Ещё».
 * Невалидные и отрицательные task counters трактуются как 0,
 * чтобы a11y не озвучивал «0 задач» или отрицательные значения.
 */
export function moreMenuA11yLabel(taskBadge: number, _chatUnread = 0): string {
  const tasks = Number.isFinite(taskBadge) ? Math.max(0, taskBadge) : 0;
  if (tasks <= 0) return 'Ещё';
  return `Ещё, ${formatTasks(tasks)} во входящих`;
}
