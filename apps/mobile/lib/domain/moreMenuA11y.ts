/** W77: a11y шапки «Ещё» — задачи inbox ≠ непрочитанный чат (чат в dock). */
export function moreMenuA11yLabel(taskBadge: number, chatUnread = 0): string {
  if (taskBadge <= 0 && chatUnread <= 0) return 'Ещё';
  const parts: string[] = ['Ещё'];
  if (taskBadge > 0) {
    parts.push(taskBadge === 1 ? '1 задача во входящих' : `${taskBadge} задач во входящих`);
  }
  if (chatUnread > 0) {
    parts.push(
      chatUnread === 1 ? '1 непрочитанное в сообщениях' : `${chatUnread} непрочитанных в сообщениях`,
    );
  }
  return parts.join(', ');
}
