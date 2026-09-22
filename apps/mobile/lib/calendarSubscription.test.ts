/**
 * Лента календаря по токену существовала на сервере, но токен нигде не
 * выдавался: подписаться было нельзя в принципе. Экран обязан выдавать
 * ссылку, называть её ценой и уметь её погасить.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const src = (rel: string) => readFileSync(join(mobile, rel), 'utf8');

const apiSrc = src('lib/api/calendar.ts');
const sheet = src('components/renova/schedule/CalendarSubscriptionSheet.tsx');
const toolbar = src('components/renova/schedule/ScheduleIconToolbar.tsx');
const honesty = src('lib/calendarIcsNav.ts');

for (const name of ['calendarSubscription', 'issueCalendarSubscription', 'revokeCalendarSubscription']) {
  if (!apiSrc.includes(`${name}:`)) throw new Error(`нет клиентского метода ${name}`);
}
if (!apiSrc.includes("'/api/v1/calendar/subscription'")) throw new Error('подписка бьёт не в ту ручку');
if (!/revokeCalendarSubscription[\s\S]{0,300}method: 'DELETE'/.test(apiSrc)) {
  throw new Error('отключение подписки не шлёт DELETE');
}

if (!sheet.includes('Кто получит ссылку, увидит ваш календарь без входа')) {
  throw new Error('цена ссылки не названа — это доступ, а не просто адрес');
}
if (!sheet.includes("confirmDestructive(\n      'Перевыпустить ссылку?'")) {
  throw new Error('перевыпуск без подтверждения — он гасит чужие подписки');
}
if (!sheet.includes("confirmDestructive(\n      'Отключить подписку?'")) {
  throw new Error('отключение без подтверждения');
}
if (!sheet.includes('Clipboard.setStringAsync(url)')) throw new Error('ссылку нельзя скопировать');
if (!sheet.includes('Подписка не заведена')) throw new Error('пустое состояние молчит');

if (!toolbar.includes("label: 'Подписка на календарь'")) throw new Error('в панель календаря не ведёт кнопка');
if (!toolbar.includes('<CalendarSubscriptionSheet')) throw new Error('форма подписки не подключена');

const honestyText = honesty.split('export const ICS_SYNC_HONESTY')[1]?.split(';')[0] ?? '';
if (!honestyText) throw new Error('не удалось прочитать подпись о синхронизации');
if (honestyText.includes('не live-синхронизация')) {
  throw new Error('устаревшая формулировка: живая лента теперь есть');
}
if (!honestyText.includes('подписку')) throw new Error('подпись не упоминает подписку');
if (!honesty.includes('в Renova не вернутся')) {
  throw new Error('односторонность подписки не проговорена');
}

console.log('calendarSubscription.test OK');
