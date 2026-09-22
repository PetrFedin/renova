/**
 * Запрос с потерянным идентификатором не уходит на сервер.
 *
 * Найдено разбором журнала аудита — не догадкой, а списком того, что у людей
 * уже ломалось. В `audit_logs` за 2026-09-17 нашлись пути с двойным слэшем:
 *
 *   POST /api/v1/projects/{id}/issues//close       404, 3 раза
 *   POST /api/v1/projects/{id}/issues//transition  404, 3 раза
 *   POST /api/v1/projects/{id}/purchases//status   404, 3 раза
 *
 * Двойной слэш — это подстановка пустой строки в шаблон адреса. Тип
 * объявляет `id: string`, и проверка типов такого не ловит: пустая строка —
 * законная строка.
 *
 * Человек видел «не найдено» про дефект, который у него перед глазами.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { LostIdentifierError, guardPath, hasLostIdentifier } from './pathGuard';

const ROOT = new URL('../../', import.meta.url).pathname;
const client = readFileSync(`${ROOT}lib/api/client.ts`, 'utf8');
const queue = readFileSync(`${ROOT}lib/offlineQueue.ts`, 'utf8');

/** Ровно те адреса, что нашлись в журнале. */
const FROM_THE_AUDIT_LOG = [
  '/api/v1/projects/p1/issues//close',
  '/api/v1/projects/p1/issues//transition',
  '/api/v1/projects/p1/purchases//status',
];

test('адреса из журнала аудита распознаются как потерянный идентификатор', () => {
  for (const path of FROM_THE_AUDIT_LOG) {
    assert.equal(hasLostIdentifier(path), true, `пропущен: ${path}`);
  }
});

test('хвостовой слэш — тот же потерянный сегмент', () => {
  assert.equal(hasLostIdentifier('/api/v1/projects/p1/issues/'), true);
});

test('обычные адреса проходят', () => {
  for (const path of [
    '/api/v1/projects/p1/issues',
    '/api/v1/projects/p1/issues/i1/close',
    '/api/v1/projects/p1/issues?status=open',
    '/api/v1/contractors',
  ]) {
    assert.equal(hasLostIdentifier(path), false, `ложное срабатывание: ${path}`);
  }
});

test('двойной слэш в строке запроса не считается потерей', () => {
  // `?returnTo=/(customer)//home` — это значение параметра, а не сегмент пути.
  assert.equal(hasLostIdentifier('/api/v1/projects/p1/issues?next=a//b'), false);
});

test('guardPath бросает понятную человеку ошибку', () => {
  assert.throws(
    () => guardPath('/api/v1/projects/p1/issues//close'),
    (error: unknown) => {
      assert.ok(error instanceof LostIdentifierError);
      // Про «не найдено» речи нет: дело не в сервере.
      assert.ok(!/не найден/i.test((error as Error).message));
      assert.match((error as Error).message, /Обновите экран/);
      return true;
    },
  );
});

test('ошибка несёт адрес — иначе разбирать будет нечего', () => {
  try {
    guardPath('/api/v1/projects/p1/purchases//status');
    assert.fail('не бросило');
  } catch (error) {
    assert.equal((error as LostIdentifierError).path, '/api/v1/projects/p1/purchases//status');
  }
});

test('guardPath молчит на исправном адресе', () => {
  assert.doesNotThrow(() => guardPath('/api/v1/projects/p1/issues/i1/close'));
});

test('рубеж стоит на единственном входе всех запросов', () => {
  assert.match(client, /guardPath\(path\);/);
  assert.match(client, /import \{ guardPath \} from '@\/lib\/api\/pathGuard';/);
});

test('рубеж стоит и на входе в офлайн-очередь', () => {
  // Обречённый запрос в очереди повторялся бы при каждом восстановлении связи.
  assert.match(queue, /guardPath\(job\.path\);/);
});

test('пустой адрес не считается потерей', () => {
  // Это другая беда, и путать их не надо.
  assert.equal(hasLostIdentifier(''), false);
  assert.equal(hasLostIdentifier('/'), false);
});
