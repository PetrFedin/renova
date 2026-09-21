/**
 * Сбой сервера клиент не выдаёт за обрыв связи.
 *
 * Пока ответ 500 уходил без заголовка CORS, браузер ронял `fetch`
 * `TypeError: Failed to fetch` — тем же, чем падает выключенный сервер, — и
 * клиент добросовестно писал «Проверьте соединение». Сервер это починил;
 * здесь проверяется вторая половина: когда ответ 500 доходит, клиент
 * показывает его текст, а не сетевую отговорку.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url).pathname;
const client = readFileSync(`${ROOT}lib/api/client.ts`, 'utf8');

test('сетевая отговорка осталась только для настоящего обрыва', () => {
  // Она нужна: без сети это правда. Важно, что путь один и он про TypeError.
  const branches = client.match(/Проверьте соединение и повторите/g) || [];
  assert.ok(branches.length > 0, 'сетевое сообщение исчезло — офлайн перестанет объясняться');
  for (const m of client.matchAll(/error instanceof TypeError[\s\S]{0,220}?Проверьте соединение/g)) {
    assert.ok(m[0].includes('TypeError'));
  }
});

test('ответ сервера с кодом не теряет код в пользу текста', () => {
  // `detail` по соглашению FastAPI — код. Но если сервер прислал `code`
  // отдельно, кодом ошибки становился целый русский текст сообщения.
  assert.match(client, /code: j\.code \|\| j\.detail/);
});

test('текст ошибки берётся из ответа сервера, а не подменяется', () => {
  assert.match(client, /return \{ message: j\.detail, code: j\.code \|\| j\.detail, detail \};/);
});

test('ответ 500 доходит до ApiError со своим статусом', () => {
  // Без этого «сервер упал» и «нет сети» снова стали бы неразличимы.
  assert.match(client, /new ApiError\(res\.status, parsed\.message, parsed\.code, parsed\.detail\)/);
});
