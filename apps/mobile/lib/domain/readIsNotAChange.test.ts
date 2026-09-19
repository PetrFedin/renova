/**
 * Чтение проекта — не изменение проекта.
 *
 * `loadProject` объявлял шине «данные проекта изменились» при каждой загрузке.
 * Слушатели в ответ перезагружали проект, тот снова объявлял — шина замыкалась
 * сама на себя.
 *
 * Измерено на живом приложении, вход на экран «Ремонт», окно 10 секунд:
 *
 *     419 запросов  — до правок
 *     233           — после того, как эффект фокуса перестал зависеть от колбэка
 *      61           — после того, как чтение перестало считаться изменением
 *       0           — второе окно подряд: цикла нет
 *
 * Серверный лимит — 120 запросов в минуту. Под ним всё отвечало 429, и экран
 * этапа навсегда оставался на «Загрузка…».
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ROOT = new URL('../../', import.meta.url).pathname;
const context = readFileSync(`${ROOT}lib/context/RenovaContext.tsx`, 'utf8');

/** Тело `loadProject` от объявления до конца колбэка. */
function loadProjectBody(): string {
  const start = context.indexOf('const loadProject = useCallback(');
  assert.ok(start > 0, 'loadProject не найден');
  const end = context.indexOf('const ensureActiveProject', start);
  assert.ok(end > start, 'не удалось ограничить тело loadProject');
  return context.slice(start, end);
}

test('загрузка проекта не объявляет изменение безусловно', () => {
  const body = loadProjectBody();
  const notifyLine = body
    .split('\n')
    .find((line) => line.includes('notifyProjectDataChanged()') && !line.trim().startsWith('//'));
  assert.ok(notifyLine, 'уведомление исчезло совсем — переключение объекта перестанет обновлять экраны');

  // Уведомление должно стоять под условием, а не в общем потоке.
  const indent = notifyLine.length - notifyLine.trimStart().length;
  assert.ok(
    indent >= 10,
    `уведомление вызывается безусловно (отступ ${indent}) — чтение снова станет изменением`,
  );
});

test('условие — смена объекта, а не флаг «уже уведомляли»', () => {
  const body = loadProjectBody();
  assert.match(
    body,
    /lastNotifiedProjectRef\.current !== id/,
    'сравнение по идентификатору: возврат на прежний объект — это снова переключение',
  );
});

test('переключение объекта по-прежнему оповещает экраны', () => {
  // Правка не должна выключить шину: соседние экраны обязаны перечитать данные,
  // когда пользователь перешёл на другой объект.
  const body = loadProjectBody();
  const conditional = body.slice(body.indexOf('switchedProject'));
  assert.match(conditional, /if \(switchedProject\) \{[\s\S]*?notifyProjectDataChanged\(\);/);
});

test('память о последнем объекте живёт в ref, а не в состоянии', () => {
  // Состояние вызвало бы лишний рендер на каждой загрузке — то, от чего уходим.
  assert.match(context, /const lastNotifiedProjectRef = useRef<string \| null>\(null\)/);
});
