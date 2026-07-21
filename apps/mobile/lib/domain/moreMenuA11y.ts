/** A11y «Ещё» — только action-единицы; сообщения на dock «Сообщения». */
export function moreMenuA11yLabel(taskBadge: number, _chatUnread = 0): string {
  const tasks = Math.max(0, taskBadge || 0);
  if (tasks <= 0) return 'Ещё';
  if (tasks === 1) return 'Ещё, 1 задача требует внимания';
  if (tasks >= 2 && tasks <= 4) return `Ещё, ${tasks} задачи требуют внимания`;
  return `Ещё, ${tasks} задач требуют внимания`;
}
