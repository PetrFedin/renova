/**
 * A11y навигационных badge.
 * «Ещё» — только задачи раздела; сообщения озвучиваются на вкладке «Сообщения».
 */
import {
  calendarTabA11yLabel,
  messagesTabA11yLabel,
  moreTabA11yLabel,
} from './navigationBadges';

/** @deprecated имя сохранено для импортов; семантика — только tasks/notifications */
export function moreMenuA11yLabel(taskBadge: number, _chatUnread = 0): string {
  return moreTabA11yLabel(taskBadge, _chatUnread);
}

export function chatMessagesA11yLabel(chatUnread: number, tabLabel = 'Сообщения'): string {
  return messagesTabA11yLabel(chatUnread, tabLabel);
}

export function calendarDockA11yLabel(dueTasks: number, tabLabel = 'Календарь'): string {
  return calendarTabA11yLabel(dueTasks, tabLabel);
}
