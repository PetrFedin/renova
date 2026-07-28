/** A11y шапки «Меню» — только задачи inbox (чат озвучивается на dock «Сообщения»).
 * Clarity E: «Меню» ≠ Home «Сводка» ≠ hub-вкладка «Все». */
export function moreMenuA11yLabel(taskBadge: number, chatUnread = 0): string {
  void chatUnread; // сигнатура совместима с вызовами OsSectionMenu
  if (taskBadge <= 0) return 'Меню';
  if (taskBadge === 1) return 'Меню, 1 задача во входящих';
  return `Меню, ${taskBadge} задач во входящих`;
}
