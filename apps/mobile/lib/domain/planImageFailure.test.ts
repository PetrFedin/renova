/**
 * Не открывшийся чертёж должен говорить об этом, а не показывать пустоту.
 *
 * Найдено обходом живого приложения. Запись плана в базе есть, файла в
 * хранилище нет: `GET /api/v1/media/photos/….jpg` отвечает `404` с
 * `content-type: application/json`, и браузер блокирует ответ как не-картинку
 * (`ERR_BLOCKED_BY_ORB`). У `<Image>` не было ни `onError`, ни запасного
 * состояния — пользователь видел пустой серый прямоугольник, а подпись сверху
 * продолжала утверждать «план загружен».
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ROOT = new URL('../../', import.meta.url).pathname;
const panel = readFileSync(`${ROOT}components/renova/FloorPlanPanel.tsx`, 'utf8');
const overview = readFileSync(`${ROOT}components/screens/object/PlanTabOverview.tsx`, 'utf8');

test('у чертежа есть обработчик неудачи', () => {
  const image = panel.slice(panel.indexOf('<Image'), panel.indexOf('<Image') + 400);
  assert.match(image, /onError=/, 'без onError неудача остаётся пустым прямоугольником');
});

test('неудача объясняется и даёт выход', () => {
  assert.match(panel, /Чертёж не открылся/);
  assert.match(panel, /Загрузить план заново/, 'состояние без действия — тупик');
});

test('сохранённые метки не объявляются потерянными', () => {
  // Замечания и метки лежат в базе и никуда не делись — пугать ими нельзя.
  assert.match(panel, /Метки и замечания сохранены/);
});

test('неудача помнит конкретный файл, а не просто факт', () => {
  // Флаг «была ошибка» закрыл бы и новый чертёж после замены плана.
  assert.match(panel, /brokenPlanUrl === plan\?\.image_url/);
});

test('подпись сверху не спорит с сообщением снизу', () => {
  // «план загружен» рядом с «Чертёж не открылся» читается как противоречие.
  assert.ok(
    !/'план загружен'/.test(overview),
    'подпись утверждает загрузку там, где файл может не открыться',
  );
  assert.match(overview, /чертёж прикреплён/);
});

test('пустое состояние без плана осталось прежним', () => {
  // Правка не должна подменять «плана нет» на «план сломан».
  assert.match(overview, /план этажа ещё не загружен/);
});
