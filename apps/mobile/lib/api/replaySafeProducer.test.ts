import assert from 'node:assert/strict';

process.env.EXPO_PUBLIC_APP_ENV = 'test';
process.env.EXPO_PUBLIC_API_URL = 'http://127.0.0.1:39996';

async function main() {
  const asyncStorageModule = await import('@react-native-async-storage/async-storage');
  const AsyncStorage = asyncStorageModule.default as typeof asyncStorageModule.default & Record<string, unknown>;
  const memory = new Map<string, string>();
  Object.assign(AsyncStorage, {
    getItem: async (key: string) => memory.get(key) ?? null,
    setItem: async (key: string, value: string) => { memory.set(key, value); },
    removeItem: async (key: string) => { memory.delete(key); },
    multiRemove: async (keys: string[]) => { keys.forEach((key) => memory.delete(key)); },
    multiSet: async (pairs: [string, string][]) => { pairs.forEach(([key, value]) => memory.set(key, value)); },
  });

  const authority = await import('../sessionAuthority');
  const client = await import('./client');
  const queue = await import('../offlineQueue');
  const { receiptsApi } = await import('./receipts');
  const { chatsApi } = await import('./chats');

  const originalFetch = globalThis.fetch;
  const userId = 'producer-user';

  async function resetQueue() {
    memory.delete(queue.OFFLINE_QUEUE_KEY);
  }

  try {
    memory.clear();
    authority.invalidateSessionAuthority();
    authority.beginSessionAuthority(userId);
    client.setAccessToken('producer-access');

    await resetQueue();
    globalThis.fetch = (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch;
    await assert.rejects(
      receiptsApi.addManualReceipt(
        userId,
        'project-1',
        1250,
        'Краска',
        'materials',
        null,
        null,
        null,
        'receipt-producer-0001',
      ),
      /offline_queued/,
    );
    let jobs = await queue.getQueue();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0]?.path, '/api/v1/projects/project-1/receipts/manual');
    const receiptBody = JSON.parse(jobs[0]!.body) as Record<string, unknown>;
    assert.equal(receiptBody.client_request_id, 'receipt-producer-0001');
    assert.equal(receiptBody.amount, 1250);

    await resetQueue();
    globalThis.fetch = (async () => new Response(JSON.stringify({
      detail: { code: 'idempotency_conflict', message: 'conflict' },
    }), { status: 409 })) as typeof fetch;
    await assert.rejects(
      receiptsApi.addManualReceipt(
        userId,
        'project-1',
        1250,
        'Краска',
        'materials',
        null,
        null,
        null,
        'receipt-producer-conflict',
      ),
      (error: unknown) => error instanceof client.ApiError && error.status === 409,
    );
    assert.equal((await queue.getQueue()).length, 0);

    await resetQueue();
    globalThis.fetch = (async () => new Response('{broken-json', { status: 200 })) as typeof fetch;
    await assert.rejects(
      receiptsApi.addManualReceipt(
        userId,
        'project-1',
        900,
        'Доставка',
        'delivery',
        null,
        null,
        null,
        'receipt-producer-malformed',
      ),
      /offline_queued/,
    );
    jobs = await queue.getQueue();
    assert.equal(jobs.length, 1);
    assert.equal(JSON.parse(jobs[0]!.body).client_request_id, 'receipt-producer-malformed');

    await resetQueue();
    globalThis.fetch = (async () => new Response('unavailable', { status: 503 })) as typeof fetch;
    await assert.rejects(
      chatsApi.sendChatMessage(userId, 'project-1', 'thread-1', 'Проверка связи'),
      /offline_queued/,
    );
    jobs = await queue.getQueue();
    assert.equal(jobs.length, 1);
    const chatBody = JSON.parse(jobs[0]!.body) as Record<string, unknown>;
    assert.equal(typeof chatBody.client_request_id, 'string');
    assert.ok(String(chatBody.client_request_id).startsWith('chat-'));
    assert.equal(chatBody.text, 'Проверка связи');

    await resetQueue();
    authority.beginSessionAuthority('other-user');
    client.setAccessToken('other-access');
    await assert.rejects(
      receiptsApi.addManualReceipt(
        userId,
        'project-1',
        100,
        'Old session',
        'other',
        null,
        null,
        null,
        'receipt-old-session-0001',
      ),
      (error: unknown) => error instanceof client.ApiError && error.code === 'session_generation_changed',
    );
    assert.equal((await queue.getQueue()).length, 0);

    console.log('replaySafeProducer.test OK');
  } finally {
    globalThis.fetch = originalFetch;
    client.setAccessToken(null);
    client.setRefreshToken(null);
    authority.invalidateSessionAuthority();
    memory.clear();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
