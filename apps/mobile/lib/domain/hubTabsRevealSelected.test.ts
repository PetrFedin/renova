/**
 * Выбранная вкладка не прячется за обрезом экрана.
 *
 * Найдено обходом на габаритах айфона (375 pt). Экран «Деньги»: ряд вкладок
 * «План–факт · Расходы · Оплаты · Отклонения» в 375 pt не помещается, а
 * активна была именно последняя — от неё виднелось полторы буквы. Ряд
 * прокручивается вбок, но указатель прокрутки скрыт, и понять это неоткуда.
 *
 * Прокрутка к выбранной вкладке отсутствовала: ни ref, ни scrollTo.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ROOT = new URL('../../', import.meta.url).pathname;
const source = readFileSync(`${ROOT}components/renova/os/OsHubTabs.tsx`, 'utf8');

test('ряд вкладок умеет прокручиваться к выбранной', () => {
  assert.match(source, /scrollTo\(\{ x: next, animated: true \}\)/);
  assert.match(source, /ref=\{scroller\}/);
});

test('каждая вкладка сообщает свои размеры', () => {
  // Без onLayout прокручивать было бы не к чему.
  assert.match(source, /onLayout=\{onTabLayout\(t\.id\)\}/);
});

test('подкрутка повторяется при смене выбора', () => {
  assert.match(source, /useEffect\(revealSelected, \[revealSelected, visible\.length\]\)/);
});

test('подкрутка повторяется, когда «Все» раскрывает скрытые вкладки', () => {
  // Раскрытие меняет число вкладок — выбранная могла уехать за обрез.
  assert.match(source, /visible\.length\]/);
});

test('замер вкладки сам зовёт подкрутку', () => {
  // Замер вкладок приходит после замера контейнера. Без этого вызова звать
  // подкрутку было некому — и первая версия правки на экране не сработала.
  assert.match(source, /reveal\.current\(\);/);
  assert.match(source, /reveal\.current = revealSelected;/);
});

test('обработчик замера не пересоздаётся на каждый рендер', () => {
  // Иначе у каждой вкладки новый onLayout и лишний круг замеров.
  assert.match(source, /const onTabLayout = useCallback\([\s\S]*?\n    \[\],\n  \);/);
});

test('без замеров ничего не двигается', () => {
  // Иначе первый кадр уносил бы ряд в ноль ещё до layout.
  assert.match(source, /if \(!box \|\| width <= 0\) return;/);
});

test('подкрутка не липнет к обрезу', () => {
  assert.match(source, /const GUTTER = 12;/);
  assert.match(source, /box\.x - GUTTER/);
  assert.match(source, /box\.x \+ box\.width \+ GUTTER/);
});

test('ряд не прокручивается левее начала', () => {
  assert.match(source, /Math\.max\(0, next\)/);
});

test('ручная прокрутка не сбрасывается подкруткой', () => {
  // Позицию берём из onScroll, а не из своей памяти: иначе жест пользователя
  // и подкрутка спорили бы друг с другом.
  assert.match(source, /offset\.current = e\.nativeEvent\.contentOffset\.x/);
  assert.match(source, /if \(Math\.abs\(next - offset\.current\) < 1\) return;/);
});

test('прежнее поведение ряда сохранено', () => {
  // Прокрутка вбок, скрытый указатель, вторичные вкладки за «Все».
  assert.match(source, /horizontal/);
  assert.match(source, /showsHorizontalScrollIndicator=\{false\}/);
  assert.match(source, /accessibilityLabel="Все вкладки"/);
  assert.match(source, /accessibilityRole="tab"/);
  assert.match(source, /accessibilityState=\{\{ selected: on \}\}/);
});
