/**
 * #317 требует проверки через настоящий `req`, а не через подменённый
 * TypeError в обход нормализации: именно нормализация и ломала очередь.
 *
 * Здесь `req` вызывается по-настоящему, с подменённым `fetch`, и результат
 * его нормализации отдаётся классификатору.
 */
import { isAmbiguousWriteFailure } from './failurePolicy';

type Case = { name: string; fetchImpl: () => Promise<Response>; expectEnqueue: boolean };

async function classifyThroughReq(fetchImpl: () => Promise<Response>): Promise<{
  status: unknown;
  code: unknown;
  enqueue: boolean;
}> {
  const originalFetch = globalThis.fetch;
  (globalThis as { fetch: unknown }).fetch = fetchImpl;
  try {
    const { req } = await import('./client');
    await req('/api/v1/projects/p1/receipts/manual', { method: 'POST', body: '{}' }, 'user-1');
    throw new Error('запрос обязан был упасть');
  } catch (error) {
    const err = error as { status?: unknown; code?: unknown; message?: unknown };
    return { status: err.status, code: err.code, enqueue: isAmbiguousWriteFailure(error) };
  } finally {
    (globalThis as { fetch: unknown }).fetch = originalFetch;
  }
}

function jsonResponse(status: number): Response {
  return new Response(JSON.stringify({ detail: 'нет' }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const cases: Case[] = [
  {
    name: 'обрыв связи',
    fetchImpl: () => Promise.reject(new TypeError('Failed to fetch')),
    expectEnqueue: true,
  },
  { name: 'сбой сервера 500', fetchImpl: () => Promise.resolve(jsonResponse(500)), expectEnqueue: true },
  { name: 'отказ 422', fetchImpl: () => Promise.resolve(jsonResponse(422)), expectEnqueue: false },
  { name: 'отказ 403', fetchImpl: () => Promise.resolve(jsonResponse(403)), expectEnqueue: false },
];

async function main() {
  for (const testCase of cases) {
    const result = await classifyThroughReq(testCase.fetchImpl);
    if (result.enqueue !== testCase.expectEnqueue) {
      throw new Error(
        `${testCase.name}: очередь ${result.enqueue ? 'достижима' : 'недостижима'}, ` +
          `ожидалось обратное (status=${String(result.status)}, code=${String(result.code)})`,
      );
    }
  }

  // Обрыв связи обязан приходить именно нормализованным: на этом и ломалось.
  const network = await classifyThroughReq(() => Promise.reject(new TypeError('Failed to fetch')));
  if (network.status !== 0) {
    throw new Error(`обрыв связи пришёл со статусом ${String(network.status)}, ожидался 0`);
  }

  console.log('normalizedTransportFailure.test OK');
}

void main();
