import assert from 'node:assert/strict';

process.env.EXPO_PUBLIC_APP_ENV = 'test';
process.env.EXPO_PUBLIC_API_URL = 'http://127.0.0.1:39990';

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
  const { floorApi } = await import('./floor');

  const originalFetch = globalThis.fetch;
  const userId = 'waste-mobile-user';

  try {
    memory.clear();
    authority.invalidateSessionAuthority();
    authority.beginSessionAuthority(userId);
    client.setAccessToken('waste-mobile-access');

    await queue.clearQueue();
    globalThis.fetch = (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch;
    await assert.rejects(
      floorApi.createWasteOrder(userId, 'project-waste-1', { volume_m3: 2, price: 1500 }),
      /offline_queued/,
    );
    let jobs = await queue.getQueue();
    assert.equal(jobs.length, 1);
    let body = JSON.parse(jobs[0]!.body) as Record<string, unknown>;
    assert.equal(body.volume_m3, 2);
    assert.ok(String(body.client_request_id).startsWith('waste-order-'));

    for (const [name, action, suffix] of [
      ['request', () => floorApi.requestWasteOrder(userId, 'project-waste-1', 'waste-1'), '/request'],
      ['approve', () => floorApi.approveWasteOrder(userId, 'project-waste-1', 'waste-1'), '/approve'],
      ['reject', () => floorApi.rejectWasteOrder(userId, 'project-waste-1', 'waste-1'), '/reject'],
      ['complete', () => floorApi.completeWasteOrder(userId, 'project-waste-1', 'waste-1'), '/complete'],
    ] as const) {
      await queue.clearQueue();
      globalThis.fetch = (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch;
      await assert.rejects(action(), /offline_queued/, `${name} should queue only as replay-safe state transition`);
      jobs = await queue.getQueue();
      assert.equal(jobs.length, 1);
      assert.ok(jobs[0]!.path.endsWith(suffix));
    }

    await queue.clearQueue();
    globalThis.fetch = (async () => new Response(JSON.stringify({
      detail: { code: 'invalid_waste_order_transition' },
    }), { status: 409 })) as typeof fetch;
    await assert.rejects(
      floorApi.approveWasteOrder(userId, 'project-waste-1', 'waste-1'),
      (error: unknown) => error instanceof client.ApiError && error.status === 409,
    );
    assert.equal((await queue.getQueue()).length, 0);

    console.log('wasteOrderRecovery.test OK');
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
