/** A11y шапки «Ещё» — только задачи; сообщения на отдельной иконке / dock. */
import { pluralRu } from '../formatUnreadMessagesRu';

export function moreMenuA11yLabel(taskBadge: number, _chatUnread = 0): string {
  const tasks = Math.max(0, taskBadge || 0);
  if (tasks <= 0) return 'Ещё';
  const noun = pluralRu(tasks, 'задача требует', 'задачи требуют', 'задач требуют');
  return `Ещё, ${tasks} ${noun} внимания`;
}

/** A11y верхней иконки сообщений / dock. */
export function chatMessagesA11yLabel(chatUnread: number): string {
  const n = Math.max(0, chatUnread || 0);
  if (n <= 0) return 'Сообщения';
  const noun = pluralRu(n, 'непрочитанное сообщение', 'непрочитанных сообщения', 'непрочитанных сообщений');
  return `Сообщения, ${n} ${noun}`;
}
