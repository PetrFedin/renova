import assert from 'node:assert/strict';

process.env.EXPO_PUBLIC_APP_ENV = 'test';
process.env.EXPO_PUBLIC_API_URL = 'http://127.0.0.1:39994';

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
  const userId = 'chat-reaction-mobile-user';

  try {
    memory.clear();
    authority.invalidateSessionAuthority();
    authority.beginSessionAuthority(userId);
    client.setAccessToken('chat-reaction-mobile-access');

    await queue.clearQueue();
    globalThis.fetch = (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch;
    await assert.rejects(
      chatsApi.reactChatMessage(userId, 'project-r1', 'thread-r1', 'message-r1', '👍', true),
      /offline_queued/,
    );
    let jobs = await queue.getQueue();
    assert.equal(jobs.length, 1);
    let body = JSON.parse(jobs[0]!.body) as Record<string, unknown>;
    assert.equal(body.emoji, '👍');
    assert.equal(body.reacted, true);

    await queue.clearQueue();
    await assert.rejects(
      chatsApi.reactChatMessage(userId, 'project-r1', 'thread-r1', 'message-r1', '👍', false),
      /offline_queued/,
    );
    jobs = await queue.getQueue();
    assert.equal(jobs.length, 1);
    body = JSON.parse(jobs[0]!.body) as Record<string, unknown>;
    assert.equal(body.emoji, '👍');
    assert.equal(body.reacted, false);

    // Deterministic conflicts/errors must not be hidden as offline work.
    await queue.clearQueue();
    globalThis.fetch = (async () => new Response(JSON.stringify({ detail: 'forbidden' }), { status: 403 })) as typeof fetch;
    await assert.rejects(
      chatsApi.reactChatMessage(userId, 'project-r1', 'thread-r1', 'message-r1', '✅', true),
      (error: unknown) => error instanceof client.ApiError && error.status === 403,
    );
    assert.equal((await queue.getQueue()).length, 0);

    console.log('chatReactionRecovery.test OK');
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
