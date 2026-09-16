import assert from 'node:assert/strict';

process.env.EXPO_PUBLIC_APP_ENV = 'test';
process.env.EXPO_PUBLIC_API_URL = 'http://127.0.0.1:39995';

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
  const { chatsApi } = await import('./chats');

  const originalFetch = globalThis.fetch;
  const userId = 'chat-thread-mobile-user';

  try {
    memory.clear();
    authority.invalidateSessionAuthority();
    authority.beginSessionAuthority(userId);
    client.setAccessToken('chat-thread-mobile-access');

    await queue.clearQueue();
    globalThis.fetch = (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch;
    await assert.rejects(
      chatsApi.createChat(userId, 'project-chat-1', 'Общий чат', 'coordination'),
      /offline_queued/,
    );

    let jobs = await queue.getQueue();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0]?.path, '/api/v1/projects/project-chat-1/chats');
    assert.equal(jobs[0]?.method, 'POST');
    const queuedBody = JSON.parse(jobs[0]!.body) as Record<string, unknown>;
    assert.equal(queuedBody.title, 'Общий чат');
    assert.equal(queuedBody.topic, 'coordination');
    assert.equal(typeof queuedBody.client_request_id, 'string');
    assert.ok(String(queuedBody.client_request_id).startsWith('chat-thread-'));
    assert.ok(String(queuedBody.client_request_id).length >= 8);

    // Deterministic conflict is authoritative and must never create hidden offline work.
    await queue.clearQueue();
    globalThis.fetch = (async () => new Response(JSON.stringify({
      detail: { code: 'idempotency_conflict', message: 'conflict' },
    }), { status: 409 })) as typeof fetch;
    await assert.rejects(
      chatsApi.createChat(userId, 'project-chat-1', 'Общий чат', 'coordination'),
      (error: unknown) => error instanceof client.ApiError && error.status === 409,
    );
    jobs = await queue.getQueue();
    assert.equal(jobs.length, 0);

    // Malformed 2xx is ambiguous: the server may already have committed the thread.
    globalThis.fetch = (async () => new Response('{broken-json', { status: 200 })) as typeof fetch;
    await assert.rejects(
      chatsApi.createChat(userId, 'project-chat-1', 'Снабжение', 'materials'),
      /offline_queued/,
    );
    jobs = await queue.getQueue();
    assert.equal(jobs.length, 1);
    const malformedBody = JSON.parse(jobs[0]!.body) as Record<string, unknown>;
    assert.ok(String(malformedBody.client_request_id).startsWith('chat-thread-'));
    assert.equal(malformedBody.title, 'Снабжение');

    console.log('chatThreadRecovery.test OK');
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
