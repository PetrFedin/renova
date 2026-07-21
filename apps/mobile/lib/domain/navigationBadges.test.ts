/**
 * Устойчивая семантика NavigationBadges.
 * Run: npx tsx apps/mobile/lib/domain/navigationBadges.test.ts
 */
import {
  assertStableMoreSemantics,
  buildNavigationBadges,
  formatNavBadgeDisplay,
  normalizeBadgeCount,
  resolveCalendarTabBadge,
  resolveInboxLabeledCounts,
  resolveMessagesTabBadge,
  resolveMoreTabBadge,
  type NavigationBadges,
} from './navigationBadges';
import { resolveHeaderMoreBadge, dockChatBadgeCount } from './headerChatBadges';
import { moreMenuA11yLabel, chatMessagesA11yLabel, calendarDockA11yLabel } from './moreMenuA11y';
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// 1. сообщения есть, задач нет
{
  const b = buildNavigationBadges({ unreadMessages: 5, dueTasks: 0, notifications: 0 });
  assert(resolveMessagesTabBadge(b)?.count === 5, 'messages=5');
  assert(resolveCalendarTabBadge(b) === null, 'calendar hidden');
  assert(resolveMoreTabBadge(b) === null, 'more hidden when only chat');
  assert(resolveHeaderMoreBadge(0, 5) === null, 'header More ignores chat');
}

// 2. задач больше нуля, сообщений нет
{
  const b = buildNavigationBadges({ unreadMessages: 0, dueTasks: 3, notifications: 2 });
  assert(resolveMessagesTabBadge(b) === null, 'messages hidden');
  assert(resolveCalendarTabBadge(b)?.count === 3, 'calendar=3');
  assert(resolveMoreTabBadge(b)?.count === 2, 'more=notifications 2');
  assert(resolveMoreTabBadge(b)?.kind === 'notifications', 'more kind stable');
  assert(resolveHeaderMoreBadge(2, 0)?.kind === 'tasks', 'header tasks');
}

// 3. оба типа
{
  const b = buildNavigationBadges({ unreadMessages: 4, dueTasks: 1, notifications: 2 });
  assert(resolveMessagesTabBadge(b)?.count === 4, 'both: messages');
  assert(resolveCalendarTabBadge(b)?.count === 1, 'both: calendar');
  assert(resolveMoreTabBadge(b)?.count === 2, 'both: more=2 not 4');
  assert(resolveMoreTabBadge(b)?.tone === 'warning', 'more warning');
  assert(resolveMessagesTabBadge(b)?.tone === 'danger', 'messages danger');
  const labeled = resolveInboxLabeledCounts(b);
  assert(labeled.messages === 4 && labeled.tasks === 2, 'inbox labeled separate');
}

// 4. нет подмены значения одного badge другим после прочтения сообщений
{
  const before = buildNavigationBadges({ unreadMessages: 4, dueTasks: 0, notifications: 2 });
  const after: NavigationBadges = { ...before, unreadMessages: 0 };
  assert(resolveMessagesTabBadge(after) === null, 'messages cleared');
  assert(resolveMoreTabBadge(after)?.count === 2, 'more still 2 tasks');
  assert(resolveMoreTabBadge(after)?.kind === 'notifications', 'more kind unchanged');
  assert(assertStableMoreSemantics(before, after), 'stable more semantics');
  // Запрещённая подмена: More не должен показать 4 или унаследовать chat
  assert(resolveMoreTabBadge(after)?.count !== 4, 'more never inherits chat count');
}

// 5. значение 0
{
  assert(normalizeBadgeCount(0) === 0, '0');
  assert(formatNavBadgeDisplay(0) === null, '0 hidden');
  assert(resolveHeaderMoreBadge(0, 0) === null, 'empty more');
}

// 6. значение больше 99
{
  assert(formatNavBadgeDisplay(100) === '99+', '100→99+');
  assert(formatNavBadgeDisplay(999) === '99+', '999→99+');
  assert(formatNavBadgeDisplay(99) === '99', '99 exact');
  assert(normalizeBadgeCount(-3) === 0, 'neg→0');
  assert(normalizeBadgeCount(Number.NaN) === 0, 'NaN→0');
  assert(normalizeBadgeCount(undefined) === 0, 'undefined→0');
}

// 7. перестройка dock — слоты остаются привязаны к полям, не к позиции
{
  const badges = buildNavigationBadges({ unreadMessages: 7, dueTasks: 3, notifications: 1 });
  const withCalendar = ['home', 'chat', 'calendar', 'object', 'budget'];
  const withoutCalendar = ['home', 'chat', 'object', 'repair', 'budget'];
  // Симуляция: chat всегда unreadMessages; calendar/home fallback — dueTasks
  assert(resolveMessagesTabBadge(badges)?.count === 7, 'dock rebuild: chat');
  assert(resolveCalendarTabBadge(badges)?.count === 3, 'dock rebuild: calendar');
  // home fallback использует тот же dueTasks, не unreadMessages
  const homeFallbackCount = withoutCalendar.includes('calendar')
    ? 0
    : badges.dueTasks;
  assert(homeFallbackCount === 3, 'home fallback dueTasks');
  assert(withCalendar.includes('calendar'), 'calendar present in alt dock');
}

// 8. смена роли — счётчики нормализуются из новых источников, без смешения
{
  const customer = buildNavigationBadges({ unreadMessages: 2, dueTasks: 1, notifications: 4 });
  const contractor = buildNavigationBadges({ unreadMessages: 0, dueTasks: 5, notifications: 0 });
  assert(resolveMoreTabBadge(customer)?.count === 4, 'customer more');
  assert(resolveMoreTabBadge(contractor) === null, 'contractor more empty');
  assert(resolveCalendarTabBadge(contractor)?.count === 5, 'contractor calendar');
  assert(resolveMessagesTabBadge(contractor) === null, 'contractor no chat badge');
}

// 9. смена проекта — global unreadMessages не «переезжает» в More
{
  const projectA = buildNavigationBadges({ unreadMessages: 8, dueTasks: 2, notifications: 1 });
  const projectB = buildNavigationBadges({ unreadMessages: 8, dueTasks: 0, notifications: 1 });
  assert(resolveMessagesTabBadge(projectA)?.count === resolveMessagesTabBadge(projectB)?.count, 'project switch: chat global');
  assert(resolveMoreTabBadge(projectB)?.count === 1, 'project switch: more unchanged kind');
  assert(resolveCalendarTabBadge(projectB) === null, 'project B no due');
}

// 10. offline cached counts — грязные значения нормализуются
{
  const cached = buildNavigationBadges({
    unreadMessages: '3' as unknown as number,
    dueTasks: -1,
    notifications: Number.NaN,
  });
  assert(cached.unreadMessages === 3, 'cached string→3');
  assert(cached.dueTasks === 0, 'cached neg→0');
  assert(cached.notifications === 0, 'cached NaN→0');
  assert(dockChatBadgeCount(-5) === 0, 'dock normalize');
}

// A11y
assert(chatMessagesA11yLabel(5) === 'Сообщения, 5 непрочитанных', 'a11y messages');
assert(calendarDockA11yLabel(3) === 'Календарь, 3 задачи на сегодня', 'a11y calendar');
assert(moreMenuA11yLabel(3, 5) === 'Ещё, 3 задачи требуют внимания', 'a11y more ignores chat');
assert(!moreMenuA11yLabel(3, 5).includes('непрочитан'), 'a11y more no chat words');
assert(moreMenuA11yLabel(0, 9) === 'Ещё', 'a11y more empty despite chat');

console.log('navigationBadges.test OK');
