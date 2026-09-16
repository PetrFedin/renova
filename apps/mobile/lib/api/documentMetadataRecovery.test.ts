import assert from 'node:assert/strict';

process.env.EXPO_PUBLIC_APP_ENV = 'test';
process.env.EXPO_PUBLIC_API_URL = 'http://127.0.0.1:39993';

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
  const { documentsApi } = await import('./documents');
  const { OFFLINE_UPLOAD_BLOCKED } = await import('../offlineErrors');

  const originalFetch = globalThis.fetch;
  const userId = 'document-metadata-user';

  try {
    memory.clear();
    authority.invalidateSessionAuthority();
    authority.beginSessionAuthority(userId);
    client.setAccessToken('document-metadata-access');

    await queue.clearQueue();
    globalThis.fetch = (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch;
    await assert.rejects(
      documentsApi.createProjectDocument(userId, 'project-doc-1', {
        title: 'Договор',
        document_type: 'contract',
        notes: 'metadata only',
      }),
      /offline_queued/,
    );
    let jobs = await queue.getQueue();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0]?.path, '/api/v1/projects/project-doc-1/documents');
    let body = JSON.parse(jobs[0]!.body) as Record<string, unknown>;
    assert.equal(body.title, 'Договор');
    assert.equal(typeof body.client_request_id, 'string');
    assert.ok(String(body.client_request_id).startsWith('document-'));

    await queue.clearQueue();
    globalThis.fetch = (async () => new Response(JSON.stringify({
      detail: { code: 'idempotency_conflict' },
    }), { status: 409 })) as typeof fetch;
    await assert.rejects(
      documentsApi.createProjectDocument(userId, 'project-doc-1', { title: 'Conflict' }),
      (error: unknown) => error instanceof client.ApiError && error.status === 409,
    );
    assert.equal((await queue.getQueue()).length, 0);

    // Metadata that references a file stays fail-closed instead of persisting
    // binary/file ownership assumptions in the JSON queue.
    globalThis.fetch = (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch;
    await assert.rejects(
      documentsApi.createProjectDocument(userId, 'project-doc-1', {
        title: 'Stored file',
        storage_key: 'documents/project-doc-1/existing.pdf',
      }),
      (error: unknown) => error instanceof Error && error.message === OFFLINE_UPLOAD_BLOCKED,
    );
    assert.equal((await queue.getQueue()).length, 0);

    console.log('documentMetadataRecovery.test OK');
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
