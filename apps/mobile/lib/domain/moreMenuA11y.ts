/** W77: a11y шапки «Ещё» — задачи inbox ≠ непрочитанный чат (чат в dock). */
import { formatCount } from '../i18n/ruPlural';
import { formatUnreadCount, RU_NOUN } from '../i18n/ruCountLabels';

export function moreMenuA11yLabel(taskBadge: number, chatUnread = 0): string {
  if (taskBadge <= 0 && chatUnread <= 0) return 'Ещё';
  const parts: string[] = ['Ещё'];
  if (taskBadge > 0) {
    parts.push(`${formatCount(taskBadge, RU_NOUN.task)} во входящих`);
  }
  if (chatUnread > 0) {
    parts.push(`${formatUnreadCount(chatUnread)} в сообщениях`);
  }
  return parts.join(', ');
}
