import { isAmbiguousWriteFailure } from './failurePolicy';

class FakeApiError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}

// Ровно тот случай, ради которого очередь существует: обрыв связи и таймаут
// приходят нормализованными в status=0.
if (!isAmbiguousWriteFailure(new FakeApiError(0, 'нет сети', 'network'))) {
  throw new Error('обрыв связи обязан попадать в очередь');
}
if (!isAmbiguousWriteFailure(new FakeApiError(0, 'сервер не ответил', 'timeout'))) {
  throw new Error('таймаут обязан попадать в очередь');
}

// Потеря ответа при сбое сервера: операция могла выполниться.
for (const status of [500, 502, 503, 504]) {
  if (!isAmbiguousWriteFailure(new FakeApiError(status, 'сбой'))) {
    throw new Error(`${status} обязан попадать в очередь`);
  }
}

// Сервер ответил отказом — повторять нечего.
for (const status of [400, 401, 403, 404, 409, 422]) {
  if (isAmbiguousWriteFailure(new FakeApiError(status, 'отказ'))) {
    throw new Error(`${status} не должен уходить в очередь`);
  }
}

// 429 — явный отказ со своим сроком; человек должен увидеть «повторите позже».
if (isAmbiguousWriteFailure(new FakeApiError(429, 'слишком много запросов', 'rate_limit'))) {
  throw new Error('лимит частоты не должен молча уходить в очередь');
}

// Не ApiError — прежнее поведение.
if (!isAmbiguousWriteFailure(new TypeError('Failed to fetch'))) throw new Error('сырая ошибка сети');
if (!isAmbiguousWriteFailure(null)) throw new Error('пустая ошибка');
if (!isAmbiguousWriteFailure('строка')) throw new Error('строка вместо ошибки');
// Объект без числового статуса — исход неизвестен.
if (!isAmbiguousWriteFailure({ code: 'network' })) throw new Error('объект без статуса');

console.log('failurePolicy.enqueue.test OK');
