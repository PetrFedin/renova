/**
 * Возврат из уведомления ведёт туда, откуда пришёл.
 *
 * Клиент разбирал ссылку так:
 *
 *     const [path, query = ''] = link.split('?');
 *
 * то есть брал только второй кусок. Бэкенд вкладывал обратный адрес без
 * кодирования, поэтому ссылка вида
 *
 *     /stage/<id>?returnTo=/(customer)/(tabs)/repair?tab=control
 *
 * теряла `tab=control`: человек приходил из уведомления в «Приёмку», жал
 * «Назад» и оказывался в «Этапах».
 *
 * Бэкенд теперь кодирует значение, но в базе уже лежат старые записи —
 * поэтому клиент обязан разбирать обе формы.
 *
 * Второе: обратным адресом рассылался `/(role)/(tabs)/home`. Файла с таким
 * именем нет, в списке алиасов его тоже не было — в отличие от `finance`,
 * `more`, `works`. Путь проваливался в legacy-редиректор.
 */
import assert from 'node:assert/strict';
import { TAB_ALIASES } from './legacyRoutes';
import { resolvePushLink } from './pushLinks';

// --- хвост обратного адреса не теряется ---------------------------------------

const encoded = `/stage/abc123?returnTo=${encodeURIComponent('/(customer)/(tabs)/repair?tab=control')}`;
const legacy = '/stage/abc123?returnTo=/(customer)/(tabs)/repair?tab=control';

for (const [name, link] of [['новая ссылка', encoded], ['уже сохранённая', legacy]] as const) {
  const target = resolvePushLink(link, undefined, 'customer');
  assert.ok(target, `${name}: ссылка вообще не разобралась`);
  const returnTo = String(target!.params?.returnTo ?? '');
  assert.ok(
    returnTo.includes('tab=control'),
    `${name}: обратный адрес потерял вкладку — вернёт не туда: ${returnTo}`,
  );
  assert.ok(
    returnTo.startsWith('/(customer)/(tabs)/repair'),
    `${name}: обратный адрес испорчен: ${returnTo}`,
  );
}

// Страховка: обычная ссылка без вложенного запроса не должна пострадать.
const plain = resolvePushLink('/stage/abc123', '/(customer)/(tabs)/repair?tab=works', 'customer');
assert.ok(plain);
assert.ok(
  String(plain!.params?.returnTo ?? '').includes('tab=works'),
  'обратный адрес, переданный вызывающим, потерялся',
);

// --- главная называется так, как она называется -------------------------------

for (const role of ['customer', 'contractor'] as const) {
  const alias = TAB_ALIASES[`/(${role})/(tabs)/home`];
  assert.equal(
    alias,
    `/(${role})/(tabs)/`,
    `«домой» для ${role} снова ведёт в legacy-редиректор вместо главной`,
  );
}

// ...и алиас действительно срабатывает при разборе ссылки.
const home = resolvePushLink('/(contractor)/(tabs)/home', undefined, 'contractor');
assert.ok(home, 'ссылка на главную не разобралась');
assert.ok(
  !String(home!.pathname).includes('home'),
  `ссылка на главную осталась несуществующим маршрутом: ${home!.pathname}`,
);

console.log('notificationLinkKeepsItsTail.test OK');
