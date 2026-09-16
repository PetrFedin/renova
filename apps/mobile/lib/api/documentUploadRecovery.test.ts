import assert from 'node:assert/strict';

process.env.EXPO_PUBLIC_APP_ENV = 'test';
process.env.EXPO_PUBLIC_API_URL = 'http://127.0.0.1:39992';

class FakeFormData {
  private values = new Map<string, unknown>();

  append(key: string, value: unknown) {
    this.values.set(key, value);
  }

  get(key: string) {
    return this.values.get(key) ?? null;
  }
}

async function main() {
  const originalFormData = globalThis.FormData;
  globalThis.FormData = FakeFormData as unknown as typeof FormData;

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
  const { documentsApi } = await import('./documents');
  const { OFFLINE_UPLOAD_BLOCKED } = await import('../offlineErrors');

  const originalFetch = globalThis.fetch;
  const userId = 'document-upload-user';
  const file = { uri: 'file:///tmp/contract.pdf', name: 'contract.pdf', type: 'application/pdf' };

  try {
    memory.clear();
    authority.invalidateSessionAuthority();
    authority.beginSessionAuthority(userId);
    client.setAccessToken('document-upload-access');
    await queue.clearQueue();

    const requestIds: string[] = [];
    let attempt = 0;
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      attempt += 1;
      const form = init?.body as unknown as FakeFormData;
      requestIds.push(String(form.get('client_request_id')));
      if (attempt === 1) throw new TypeError('Failed to fetch');
      return new Response(JSON.stringify({ id: 'doc-canonical', idempotent_replay: true }), { status: 200 });
    }) as typeof fetch;

    const recovered = await documentsApi.uploadProjectDocument(
      userId,
      'project-upload-1',
      file,
      { title: 'Договор' },
    ) as { id: string };
    assert.equal(recovered.id, 'doc-canonical');
    assert.equal(attempt, 2);
    assert.equal(requestIds.length, 2);
    assert.equal(requestIds[0], requestIds[1], 'bounded replay must preserve first upload command identity');
    assert.ok(requestIds[0]!.startsWith('document-upload-'));
    assert.equal((await queue.getQueue()).length, 0, 'binary upload must never enter JSON offline queue');

    // Two ambiguous failures stop after one replay and remain fail-closed.
    attempt = 0;
    requestIds.length = 0;
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      attempt += 1;
      const form = init?.body as unknown as FakeFormData;
      requestIds.push(String(form.get('client_request_id')));
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    await assert.rejects(
      documentsApi.uploadProjectDocument(userId, 'project-upload-1', file, { title: 'Смета' }),
      (error: unknown) => error instanceof Error && error.message === OFFLINE_UPLOAD_BLOCKED,
    );
    assert.equal(attempt, 2);
    assert.equal(requestIds[0], requestIds[1]);
    assert.equal((await queue.getQueue()).length, 0);

    // Deterministic client/server error is authoritative: no automatic replay.
    attempt = 0;
    globalThis.fetch = (async () => {
      attempt += 1;
      return new Response(JSON.stringify({ detail: 'invalid_client_request_id' }), { status: 422 });
    }) as typeof fetch;
    await assert.rejects(
      documentsApi.uploadProjectDocument(userId, 'project-upload-1', file),
      (error: unknown) => error instanceof client.ApiError && error.status === 422,
    );
    assert.equal(attempt, 1);

    console.log('documentUploadRecovery.test OK');
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.FormData = originalFormData;
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
