/**
 * Вкладки, хлебные крошки и настройки называют себя.
 *
 * Найдено обходом на габаритах айфона с чтением дерева доступности. На экране
 * сметы восемь вкладок подряд:
 *
 *   tab [ref_62]  tab [ref_64]  tab [ref_100] tab [ref_102]
 *   tab [ref_109] tab [ref_111] tab [ref_113] tab [ref_115]
 *
 * Роль была у всех, имени — ни у одной: читалка объявляет «вкладка» восемь
 * раз подряд и ни одну не называет.
 *
 * На экране «Данные объекта» то же у хлебных крошек, а «Вид главной»
 * (Кратко · Стандарт · Подробно) выходил как `generic` — то есть не объявлен
 * даже управлением.
 *
 * Отдельно про «← Выбор роли»: кнопка вызывает `logout()`, то есть выходит из
 * учётной записи, а подпись «Заказчик · Исполнитель» читается как
 * переключатель. Видимую надпись эта правка не трогает — это решение
 * владельца, — но имя для читалки называет последствие.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ROOT = new URL('../../', import.meta.url).pathname;
const read = (rel: string) => readFileSync(`${ROOT}${rel}`, 'utf8');

const tabs = read('components/renova/os/OsHubTabs.tsx');
const crumbs = read('components/renova/os/OsHeaderBreadcrumb.tsx');
const roleSwitch = read('components/renova/RoleSwitchButton.tsx');
const density = read('components/renova/RoleDetailPicker.tsx');
const profile = read('components/renova/ProjectProfileFields.tsx');

test('вкладка хаба называет себя', () => {
  assert.match(tabs, /accessibilityLabel=\{\s*t\.badge != null && t\.badge > 0 \? `\$\{t\.label\}, \$\{t\.badge\}` : t\.label\s*\}/);
});

test('счётчик на вкладке попадает в имя', () => {
  // Иначе о «Изменения ①» читалка не сказала бы вовсе.
  assert.match(tabs, /\$\{t\.label\}, \$\{t\.badge\}/);
});

test('роль вкладки сохранена', () => {
  assert.match(tabs, /accessibilityRole="tab"/);
  assert.match(tabs, /accessibilityState=\{\{ selected: on \}\}/);
});

test('хлебная крошка называет, куда ведёт', () => {
  assert.match(crumbs, /accessibilityLabel=\{isLast \? c\.label : `Перейти: \$\{c\.label\}`\}/);
});

test('текущая крошка не обещает перехода', () => {
  // Последняя крошка отключена — «Перейти» было бы неправдой.
  assert.match(crumbs, /accessibilityState=\{\{ disabled: isLast \}\}/);
  assert.match(crumbs, /disabled=\{isLast\}/);
});

test('«Вид главной» объявлен управлением, а не текстом', () => {
  assert.match(density, /accessibilityRole="radio"/);
  assert.match(density, /accessibilityLabel=\{`Вид главной: \$\{LBL\[o\]\}`\}/);
});

test('выбранный вид главной сообщается как выбранный', () => {
  assert.match(density, /selected: level === o, checked: level === o/);
});

test('смена роли называет последствие, а не намёк', () => {
  assert.match(roleSwitch, /Выход из учётной записи/);
  // Обе разновидности кнопки — обычная и компактная.
  const uses = roleSwitch.match(/accessibilityLabel=\{ROLE_SWITCH_A11Y\(roleLabel\)\}/g) || [];
  assert.equal(uses.length, 2, 'одна из двух разновидностей кнопки осталась безымянной');
});

test('видимая надпись кнопки роли не изменена', () => {
  // Менять текст кнопки, которая разлогинивает, — решение владельца.
  assert.match(roleSwitch, /<Text style=\{s\.btnText\}>← Выбор роли<\/Text>/);
  assert.match(roleSwitch, /<Text style=\{s\.btnSub\}>Заказчик · Исполнитель<\/Text>/);
});

test('поведение кнопки роли не изменено', () => {
  assert.match(roleSwitch, /await logout\(\);/);
  assert.match(roleSwitch, /replaceOsNav\('\/onboarding\/role'\)/);
});

test('выбор в форме «Данные» объявлен управлением', () => {
  // Тип жилья, тип ремонта и ставка НДС выходили как `generic`: читалкой
  // заполнить форму было нечем вовсе.
  const radios = profile.match(/accessibilityRole="radio"/g) || [];
  assert.equal(radios.length, 2, 'не все ряды выбора объявлены');
  const groups = profile.match(/accessibilityRole="radiogroup"/g) || [];
  assert.equal(groups.length, 2, 'ряды выбора не сгруппированы');
});

test('фишка называет поле, а не только своё значение', () => {
  // «Косметический» само по себе ни о чём не говорит.
  assert.match(profile, /accessibilityLabel=\{`\$\{groupLabel\}: \$\{item\.label\}`\}/);
  assert.match(profile, /groupLabel="Тип жилья"/);
  assert.match(profile, /groupLabel="Базовый тип ремонта"/);
});

test('ставка НДС произносится словами, а не знаком процента', () => {
  assert.match(profile, /rate === 0 \? 'без НДС' : `\$\{rate\} процентов`/);
});

test('выбранная фишка сообщается как выбранная', () => {
  assert.match(profile, /accessibilityState=\{\{ selected: on, checked: on \}\}/);
});

test('видимые подписи фишек не изменены', () => {
  assert.match(profile, /\{ id: 'cosmetic', label: 'Косметический' \}/);
  assert.match(profile, /rate === 0 \? 'Без НДС' : `\$\{rate\}%`/);
});
