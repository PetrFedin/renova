/**
 * Счёт из чата должен нести один и тот же ключ в живом запросе и в повторе.
 *
 * Здесь важна не сама генерация ключа, а место, где она происходит. Если
 * ключ создать внутри `catch`, офлайн-очередь уйдёт с другим ключом, сервер
 * увидит два разных запроса и выставит два счёта — ровно то, что чинится.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const SOURCE = new URL('./chats.ts', import.meta.url).pathname;
const source = readFileSync(SOURCE, 'utf8');

function invoiceBlock(): string {
  const start = source.indexOf('invoiceFromChat:');
  assert.ok(start > 0, 'invoiceFromChat не найден');
  const end = source.indexOf('markChatRead:', start);
  assert.ok(end > start, 'не удалось ограничить блок invoiceFromChat');
  return source.slice(start, end);
}

test('счёт из чата отправляет client_request_id', () => {
  assert.match(
    invoiceBlock(),
    /client_request_id/,
    'без ключа сервер не отличит повтор от нового счёта',
  );
});

test('ключ создаётся до попытки отправки, а не в обработчике ошибки', () => {
  const block = invoiceBlock();
  const tryAt = block.indexOf('try {');
  const keyAt = block.indexOf('newChatClientRequestId()');
  assert.ok(keyAt > 0, 'ключ вообще не создаётся');
  assert.ok(
    keyAt < tryAt,
    'ключ создаётся внутри try/catch — повтор из офлайн-очереди уйдёт с другим ключом',
  );
});

test('в сеть и в очередь уходит одно и то же тело', () => {
  const block = invoiceBlock();
  // Два разных JSON.stringify(body) — это два разных ключа.
  const serializations = block.match(/JSON\.stringify\(/g) || [];
  assert.equal(
    serializations.length,
    1,
    'тело сериализуется дважды — живой запрос и очередь разойдутся',
  );
  assert.ok(block.includes('body: serialized'), 'в очередь уходит не то тело, что в сеть');
});

test('ключ, переданный снаружи, не перетирается', () => {
  // Повторная отправка того же счёта из интерфейса должна оставаться повтором.
  assert.match(invoiceBlock(), /body\.client_request_id \?\?/);
});
