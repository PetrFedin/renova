import assert from 'node:assert/strict';

process.env.EXPO_PUBLIC_APP_ENV = 'test';
process.env.EXPO_PUBLIC_API_URL = 'http://127.0.0.1:39991';

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
  const { roomsApi } = await import('./rooms');

  const originalFetch = globalThis.fetch;
  const userId = 'room-change-mobile-user';

  try {
    memory.clear();
    authority.invalidateSessionAuthority();
    authority.beginSessionAuthority(userId);
    client.setAccessToken('room-change-mobile-access');

    await queue.clearQueue();
    globalThis.fetch = (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch;
    await assert.rejects(
      roomsApi.createRoomChangeRequest(userId, 'project-room-1', {
        room_id: 'room-1',
        message: 'Изменить название',
        payload: { name: 'Кухня-гостиная' },
      }),
      /offline_queued/,
    );
    let jobs = await queue.getQueue();
    assert.equal(jobs.length, 1);
    let body = JSON.parse(jobs[0]!.body) as Record<string, unknown>;
    assert.equal(body.room_id, 'room-1');
    assert.ok(String(body.client_request_id).startsWith('room-change-'));

    // Decision endpoints are state assignments on the server; ambiguous
    // transport may be replayed, deterministic conflicts may not.
    await queue.clearQueue();
    await assert.rejects(
      roomsApi.approveRoomChange(userId, 'project-room-1', 'request-1'),
      /offline_queued/,
    );
    jobs = await queue.getQueue();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0]?.path, '/api/v1/projects/project-room-1/room-change-requests/request-1/approve');

    await queue.clearQueue();
    globalThis.fetch = (async () => new Response(JSON.stringify({
      detail: { code: 'room_change_final_state_conflict' },
    }), { status: 409 })) as typeof fetch;
    await assert.rejects(
      roomsApi.rejectRoomChange(userId, 'project-room-1', 'request-1'),
      (error: unknown) => error instanceof client.ApiError && error.status === 409,
    );
    assert.equal((await queue.getQueue()).length, 0);

    console.log('roomChangeRecovery.test OK');
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
