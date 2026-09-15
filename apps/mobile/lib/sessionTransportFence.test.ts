import assert from 'node:assert/strict';

process.env.EXPO_PUBLIC_APP_ENV = 'test';
process.env.EXPO_PUBLIC_API_URL = 'http://127.0.0.1:39999';

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((r) => { resolve = r; });
  return { promise, resolve };
}

async function main() {
  const authority = await import('./sessionAuthority');
  const client = await import('./api/client');
  const originalFetch = globalThis.fetch;

  try {
    authority.invalidateSessionAuthority();

    authority.beginSessionAuthority('user-a');
    client.setAccessToken('access-a');
    client.setRefreshToken('refresh-a');
    const lateGet = deferredResponse();
    globalThis.fetch = (async () => lateGet.promise) as typeof fetch;

    const getPromise = client.req<{ owner: string }>(
      '/api/v1/projects',
      { cacheFallback: false },
      'user-a',
    );
    await Promise.resolve();

    authority.beginSessionAuthority('user-b');
    client.setAccessToken('access-b');
    client.setRefreshToken('refresh-b');
    lateGet.resolve(new Response(JSON.stringify({ owner: 'user-a' }), { status: 200 }));

    await assert.rejects(
      getPromise,
      (error: unknown) => error instanceof client.ApiError && error.code === 'session_generation_changed',
    );
    assert.equal(client.getAccessToken(), 'access-b');
    assert.equal(client.getRefreshToken(), 'refresh-b');
    assert.throws(
      () => client.authHeaders('user-a'),
      (error: unknown) => error instanceof client.ApiError && error.code === 'session_generation_changed',
      'B bearer must never be attached to an A request',
    );

    authority.beginSessionAuthority('user-a');
    client.setAccessToken('access-a2');
    client.setRefreshToken('refresh-a2');
    const lateRefresh = deferredResponse();
    globalThis.fetch = (async () => lateRefresh.promise) as typeof fetch;

    const refreshPromise = client.refreshAccessToken();
    await Promise.resolve();

    authority.beginSessionAuthority('user-b');
    client.setAccessToken('access-b2');
    client.setRefreshToken('refresh-b2');
    lateRefresh.resolve(new Response(JSON.stringify({
      access_token: 'late-access-a2',
      refresh_token: 'late-refresh-a2',
    }), { status: 200 }));

    await assert.rejects(
      refreshPromise,
      (error: unknown) => error instanceof client.ApiError && error.code === 'session_generation_changed',
    );
    assert.equal(client.getAccessToken(), 'access-b2');
    assert.equal(client.getRefreshToken(), 'refresh-b2');

    console.log('sessionTransportFence.test OK');
  } finally {
    globalThis.fetch = originalFetch;
    client.setAccessToken(null);
    client.setRefreshToken(null);
    authority.invalidateSessionAuthority();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
