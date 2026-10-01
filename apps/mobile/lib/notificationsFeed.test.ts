/** Лента уведомлений: группировка, счётчик, ссылка по роли. Run: tsx apps/mobile/lib/notificationsFeed.test.ts */
import assert from 'node:assert/strict';
import type { AppNotification } from './api/types/misc';
import {
  countUnread,
  formatBadge,
  groupNotificationsByDay,
  localizeLinkForRole,
  markAllReadLocal,
  markReadLocal,
  mergeNotificationPages,
  resolveNotificationTarget,
} from './notificationsFeed';

const now = new Date(2026, 9, 1, 15, 0, 0); // 1 окт 2026, локальное время
const at = (daysAgo: number, hour = 10) => new Date(2026, 9, 1 - daysAgo, hour).toISOString();
const n = (id: string, created_at: string, over: Partial<AppNotification> = {}): AppNotification => ({
  id, title: id, body: '', link_path: null, read: false, notification_type: 'other', created_at, ...over,
});

// группировка по дням, порядок сохраняется
const groups = groupNotificationsByDay(
  [n('a', at(0, 14)), n('b', at(0, 9)), n('c', at(1)), n('d', at(5)), n('e', 'garbage')],
  now,
);
assert.deepEqual(groups.map((g) => g.label), ['Сегодня', 'Вчера', '26 сентября', 'Без даты']);
assert.deepEqual(groups[0].items.map((i) => i.id), ['a', 'b']);
assert.deepEqual(groupNotificationsByDay([], now), []);
assert.equal(groupNotificationsByDay([n('y', new Date(2025, 11, 31).toISOString())], now)[0].label, '31 декабря 2025');

// счётчик и локальные отметки
const list = [n('a', at(0)), n('b', at(0), { read: true }), n('c', at(1))];
assert.equal(countUnread(list), 2);
assert.equal(countUnread(markReadLocal(list, 'a')), 1);
assert.equal(countUnread(markReadLocal(list, 'nope')), 2);
assert.equal(countUnread(markAllReadLocal(list)), 0);
assert.equal(markReadLocal(list, 'b')[1], list[1], 'already read keeps identity');
assert.equal(formatBadge(0), '0');
assert.equal(formatBadge(7), '7');
assert.equal(formatBadge(250), '99+');
assert.equal(formatBadge(-3), '0');

// склейка страниц без дублей
assert.deepEqual(mergeNotificationPages([n('a', at(0)), n('b', at(0))], [n('b', at(0)), n('c', at(1))]).map((i) => i.id), ['a', 'b', 'c']);

// ссылка → маршрут по РОЛИ пользователя
assert.equal(localizeLinkForRole('/(customer)/(tabs)/budget', 'contractor'), '/(contractor)/(tabs)/budget');
assert.equal(localizeLinkForRole('/(contractor)/(tabs)/chat', 'customer'), '/(customer)/(tabs)/chat');
assert.equal(localizeLinkForRole('/stage/s1', 'contractor'), '/stage/s1');

const stage = resolveNotificationTarget(
  { link_path: '/stage/s1?projectId=p1&returnTo=/(customer)/(tabs)/repair', notification_type: 'stage_review' },
  'contractor',
);
assert.equal(stage.pathname, '/stage/[id]');
assert.equal(stage.params.id, 's1');
assert.equal(stage.params.projectId, 'p1');
assert.equal(stage.params.returnTo, '/notification-center', 'back goes to the feed, not to a foreign role tab');

const tabC = resolveNotificationTarget({ link_path: '/(customer)/(tabs)/budget', notification_type: 'payment_pending' }, 'contractor');
assert.ok(tabC.pathname.startsWith('/(contractor)/'), `contractor must not land in customer tabs: ${tabC.pathname}`);
const tabU = resolveNotificationTarget({ link_path: '/(customer)/(tabs)/budget', notification_type: 'payment_pending' }, 'customer');
assert.ok(tabU.pathname.startsWith('/(customer)/'));

// без ссылки — по типу уведомления и роли; неизвестный тип → inbox
const byType = resolveNotificationTarget({ link_path: null, notification_type: 'payment_pending' }, 'contractor');
assert.ok(byType.pathname.startsWith('/(contractor)/'));
assert.equal(byType.params.returnTo, '/notification-center');
assert.equal(resolveNotificationTarget({ link_path: null, notification_type: 'wat' }, 'customer').pathname, '/inbox');
assert.equal(resolveNotificationTarget({ link_path: null, notification_type: 'document' }, 'customer').pathname, '/documents');

console.log('OK notificationsFeed');
