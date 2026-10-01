/** Run: tsx lib/pushTokenLifecycle.test.ts (COM-017: unbind on logout, never blocks sign-out). */
import assert from 'node:assert/strict';
import {
  PUSH_TOKEN_STORAGE_KEY,
  detachPushToken,
  rememberPushToken,
  type KeyValueStore,
} from './pushTokenLifecycle';

function memoryStore(initial: Record<string, string> = {}): KeyValueStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => { data.set(k, v); },
    removeItem: async (k) => { data.delete(k); },
  };
}

async function main() {
  // remembers the token, detaches exactly it, clears the memory
  const store = memoryStore();
  await rememberPushToken(store, 'ExponentPushToken[abc123]');
  assert.equal(store.data.get(PUSH_TOKEN_STORAGE_KEY), 'ExponentPushToken[abc123]');
  const sent: Array<string | undefined> = [];
  const ok = await detachPushToken({ storage: store, unregister: async (t) => { sent.push(t); } });
  assert.equal(ok, 'detached');
  assert.deepEqual(sent, ['ExponentPushToken[abc123]']);
  assert.equal(store.data.has(PUSH_TOKEN_STORAGE_KEY), false);

  // nothing remembered -> detach-all request (token undefined)
  const sent2: Array<string | undefined> = [];
  assert.equal(await detachPushToken({ storage: memoryStore(), unregister: async (t) => { sent2.push(t); } }), 'detached');
  assert.deepEqual(sent2, [undefined]);

  // server failure: reported, resolved (does not throw), token kept for a later retry
  const errors: unknown[] = [];
  const failing = memoryStore({ [PUSH_TOKEN_STORAGE_KEY]: 'ExponentPushToken[zzz999]' });
  const out = await detachPushToken({
    storage: failing,
    unregister: async () => { throw new Error('http_500'); },
    onError: (e) => errors.push(e),
  });
  assert.equal(out, 'failed');
  assert.equal(errors.length, 1);
  assert.equal(failing.data.get(PUSH_TOKEN_STORAGE_KEY), 'ExponentPushToken[zzz999]');

  // hanging request is cut by the timeout, so logout is never blocked
  const started = Date.now();
  const hung = await detachPushToken({
    storage: memoryStore(),
    unregister: () => new Promise(() => undefined),
    timeoutMs: 30,
    onError: (e) => errors.push(e),
  });
  assert.equal(hung, 'failed');
  assert.ok(Date.now() - started < 1000);

  // broken storage never throws
  const broken: KeyValueStore = {
    getItem: async () => { throw new Error('io'); },
    setItem: async () => { throw new Error('io'); },
    removeItem: async () => { throw new Error('io'); },
  };
  await rememberPushToken(broken, 'x');
  assert.equal(await detachPushToken({ storage: broken, unregister: async () => undefined }), 'detached');
  console.log('pushTokenLifecycle: ok');
}
void main();
