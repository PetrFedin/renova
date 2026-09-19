/**
 * Выгрузки по комнате должны иметь кнопку, а не только маршрут.
 *
 * Найдено сверкой маршрутов API с вызовами из приложения. Сервер отдаёт оба
 * файла, клиентские методы написаны целиком — и не вызывались ниоткуда:
 *
 *     GET /api/v1/projects/{id}/rooms/{room}/export.pdf → 200 application/pdf 19722 б
 *     GET /api/v1/projects/{id}/rooms/{room}/audit.pdf  → 200 application/pdf 14476 б
 *
 * Получить паспорт комнаты и акт обследования можно было только запросом к API
 * мимо приложения — для клиента их не существовало.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ROOT = new URL('../../', import.meta.url).pathname;
const screen = readFileSync(`${ROOT}components/screens/RoomDetailScreen.tsx`, 'utf8');
const rooms = readFileSync(`${ROOT}lib/api/rooms.ts`, 'utf8');
/** Перенос строки в JSX не меняет текста для пользователя. */
const screenText = screen.replace(/\s+/g, ' ');

test('обе выгрузки вызываются с экрана комнаты', () => {
  for (const method of ['exportRoomPdf', 'exportRoomAuditPdf']) {
    assert.match(rooms, new RegExp(`\\b${method}:`), `метод ${method} исчез из клиента`);
    assert.match(
      screen,
      new RegExp(`api\\.${method}\\(`),
      `${method} написан, но не вызывается — файл недоступен из приложения`,
    );
  }
});

test('у выгрузок есть подписанные кнопки, а не голый вызов', () => {
  assert.match(screenText, /Документы по комнате/);
  assert.match(screenText, /title="Паспорт комнаты"/);
  assert.match(screenText, /title="Акт обследования"/);
});

test('видно, какая именно выгрузка идёт', () => {
  // Общий флаг «занято» крутил бы обе кнопки сразу — непонятно, что скачивается.
  assert.match(screen, /loading=\{exporting === 'room'\}/);
  assert.match(screen, /loading=\{exporting === 'audit'\}/);
  assert.ok(
    !/const \[exporting, setExporting\] = useState<boolean>/.test(screen),
    'состояние выгрузки стало булевым — обе кнопки снова покажут одно и то же',
  );
});

test('неудача объясняется, а не исчезает молча', () => {
  // Скачивание может не дойти: экран обязан сказать об этом.
  assert.match(screen, /reportError\('room\.export\.pdf'/);
  assert.match(screenText, /Паспорт комнаты не сформирован/);
  assert.match(screenText, /Акт не сформирован/);
});

test('состояние выгрузки всегда снимается', () => {
  // Без finally первая же неудача навсегда заблокировала бы обе кнопки.
  assert.match(screen, /finally \{\s*setExporting\(null\);/);
});

test('повторное нажатие не запускает вторую выгрузку', () => {
  assert.match(screen, /if \(!user \|\| !activeProject \|\| !room \|\| exporting\) return;/);
});
