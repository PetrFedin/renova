/** W77: a11y шапки «Ещё» — задачи inbox ≠ непрочитанный чат (чат в dock). */
export function moreMenuA11yLabel(taskBadge: number, chatUnread = 0): string {
  if (taskBadge <= 0 && chatUnread <= 0) return 'Ещё';
  const parts: string[] = [];
  if (chatUnread > 0) {
    const mod100 = chatUnread % 100;
    const mod10 = chatUnread % 10;
    const noun = mod100 >= 11 && mod100 <= 14 ? 'непрочитанных сообщений'
      : mod10 === 1 ? 'непрочитанное сообщение'
        : mod10 >= 2 && mod10 <= 4 ? 'непрочитанных сообщения' : 'непрочитанных сообщений';
    parts.push(`${chatUnread} ${noun}`);
  }
  if (taskBadge > 0) {
    const mod100 = taskBadge % 100;
    const mod10 = taskBadge % 10;
    const noun = mod100 >= 11 && mod100 <= 14 ? 'задач'
      : mod10 === 1 ? 'задача' : mod10 >= 2 && mod10 <= 4 ? 'задачи' : 'задач';
    parts.push(`${taskBadge} ${noun} требуют внимания`);
  }
  return `Ещё. ${parts.join(', ')}.`;
}
