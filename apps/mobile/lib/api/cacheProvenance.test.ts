import assert from 'node:assert/strict';

process.env.EXPO_PUBLIC_APP_ENV = 'test';
process.env.EXPO_PUBLIC_API_URL = 'http://127.0.0.1:39997';

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

  const originalFetch = globalThis.fetch;
  const userId = 'cache-user';
  const storageKey = (path: string) => `renova_cache_get:${userId}:${path}`;

  try {
    memory.clear();
    authority.invalidateSessionAuthority();
    authority.beginSessionAuthority(userId);
    client.setAccessToken('cache-access');

    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/cache/a')) return new Response(JSON.stringify({ id: 'a' }), { status: 200 });
      if (url.endsWith('/cache/b')) return new Response(JSON.stringify({ id: 'b' }), { status: 200 });
      throw new TypeError('unexpected request');
    }) as typeof fetch;

    const [a, b] = await Promise.all([
      client.cachedGetWithMeta<{ id: string }>('/cache/a', userId),
      client.cachedGetWithMeta<{ id: string }>('/cache/b', userId),
    ]);
    assert.equal(a.provenance.path, '/cache/a');
    assert.equal(b.provenance.path, '/cache/b');
    assert.equal(a.provenance.source, 'network');
    assert.equal(b.provenance.source, 'network');
    assert.equal(client.getCacheProvenance(a.value)?.path, '/cache/a');
    assert.equal(client.getCacheProvenance(b.value)?.path, '/cache/b');

    const originalAsOf = Date.now() - 120_000;
    memory.set(storageKey('/cache/stale'), JSON.stringify({
      asOf: originalAsOf,
      t: originalAsOf,
      v: { id: 'stale' },
    }));
    let staleFetches = 0;
    globalThis.fetch = (async () => {
      staleFetches += 1;
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;

    const stale1 = await client.cachedGetWithMeta<{ id: string }>('/cache/stale', userId);
    assert.equal(stale1.provenance.stale, true);
    assert.equal(stale1.provenance.source, 'durable');
    assert.equal(stale1.provenance.reason, 'network');
    assert.equal(stale1.provenance.asOf, originalAsOf);
    assert.equal(client.getCacheProvenance(stale1.value)?.asOf, originalAsOf);

    const stale2 = await client.cachedGetWithMeta<{ id: string }>('/cache/stale', userId);
    assert.equal(stale2.provenance.asOf, originalAsOf, 'fallback must never be re-timestamped as fresh');
    assert.equal(staleFetches, 2, 'old fallback must not become a fresh in-memory hit');

    const otherAsOf = originalAsOf - 10_000;
    memory.set(storageKey('/cache/other'), JSON.stringify({ asOf: otherAsOf, v: { id: 'other' } }));
    const other = await client.cachedGetWithMeta<{ id: string }>('/cache/other', userId);
    assert.equal(other.provenance.path, '/cache/other');
    const staleKeys = client.getStaleCacheProvenance().map((meta) => meta.path);
    assert.ok(staleKeys.includes('/cache/stale'));
    assert.ok(staleKeys.includes('/cache/other'));

    memory.set(storageKey('/cache/fresh-only'), JSON.stringify({ asOf: originalAsOf, v: { id: 'cached' } }));
    await assert.rejects(
      client.req('/cache/fresh-only', {}, userId),
      (error: unknown) => error instanceof client.ApiError && error.status === 0 && error.code === 'network',
    );

    memory.set(storageKey('/cache/not-found'), JSON.stringify({ asOf: originalAsOf, v: { id: 'old' } }));
    globalThis.fetch = (async () => new Response(JSON.stringify({ detail: 'not found' }), { status: 404 })) as typeof fetch;
    await assert.rejects(
      client.cachedGetWithMeta('/cache/not-found', userId),
      (error: unknown) => error instanceof client.ApiError && error.status === 404,
    );

    console.log('cacheProvenance.test OK');
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
