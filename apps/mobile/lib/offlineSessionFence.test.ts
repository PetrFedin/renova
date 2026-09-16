import assert from 'node:assert/strict';

process.env.EXPO_PUBLIC_APP_ENV = 'test';
process.env.EXPO_PUBLIC_API_URL = 'http://127.0.0.1:39998';

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

  const authority = await import('./sessionAuthority');
  const client = await import('./api/client');
  const queue = await import('./offlineQueue');

  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = (async () => {
    fetchCount += 1;
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  try {
    memory.clear();
    authority.invalidateSessionAuthority();

    const a1 = authority.beginSessionAuthority('user-a');
    client.setAccessToken('access-a1');
    await queue.clearQueue();
    await queue.enqueue({
      path: '/api/v1/projects/project-a/issues',
      method: 'POST',
      body: JSON.stringify({ title: 'queued by A1', client_request_id: 'offline-a1-0001' }),
      userId: 'user-a',
    });

    let jobs = await queue.getQueue();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0]?.sessionId, a1.sessionId);
    assert.equal(jobs[0]?.attempts ?? 0, 0);

    authority.beginSessionAuthority('user-b');
    client.setAccessToken('access-b');
    const underB = await queue.flush('http://127.0.0.1:39998');
    assert.equal(fetchCount, 0, 'A1 job must not be sent with B authority');
    assert.ok(underB.deferred >= 1);
    jobs = await queue.getQueue();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0]?.attempts ?? 0, 0, 'owner mismatch must not consume attempts');

    const a2 = authority.beginSessionAuthority('user-a');
    client.setAccessToken('access-a2');
    assert.notEqual(a2.sessionId, a1.sessionId, 'A -> B -> A is a new logical session');
    const underA2 = await queue.flush('http://127.0.0.1:39998');
    assert.equal(fetchCount, 0, 'old A1 job must stay fenced from new A2 login');
    assert.ok(underA2.deferred >= 1);
    jobs = await queue.getQueue();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0]?.attempts ?? 0, 0);

    console.log('offlineSessionFence.test OK');
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
