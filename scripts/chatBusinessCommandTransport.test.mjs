#!/usr/bin/env node
/** Execute actual req -> chats API -> AsyncStorage queue -> flush in Node.
 * Only platform storage, network and telemetry are fakes. Never fake req/enqueue.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'apps/mobile/package.json'));
const ts = require('typescript');
const mobile = path.join(root, 'apps/mobile');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const compilerPath = path.relative(root, path.dirname(require.resolve('typescript/package.json'))).split(path.sep).join('/');
assert.equal(ts.version, lock.packages[compilerPath]?.version, 'test compiler must be the workspace lockfile version');
const compilerOptions = { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true };
function transpile(source, filename) {
  const output = ts.transpileModule(source, { fileName: filename, compilerOptions, reportDiagnostics: true });
  const diagnostics = (output.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error);
  assert.equal(diagnostics.length, 0, `${filename}: TypeScript ${ts.version}\n${diagnostics.map(d => `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`).join('\n')}`);
  return output.outputText;
}
// Negative control: the harness must reject invalid code, never suppress diagnostics.
assert.throws(() => transpile('export const broken = ;', 'invalid-canary.ts'), /TS\d+:/);
let scenarios = 0;

function harness({ storage = new Map(), network, failStorage = false } = {}) {
  const requests = [];
  const errors = [];
  const cache = new Map();
  const asyncStorage = {
    async getItem(key) { return storage.get(key) ?? null; },
    async setItem(key, value) { if (failStorage) throw new Error('storage_unavailable'); storage.set(key, value); },
    async removeItem(key) { storage.delete(key); },
  };
  const context = vm.createContext({
    console, setTimeout, clearTimeout, AbortController, URL, FormData, Response,
    Error, TypeError, SyntaxError,
    process: { env: { EXPO_PUBLIC_APP_ENV: 'test', EXPO_PUBLIC_API_URL: 'http://127.0.0.1:8100' } },
    fetch: async (url, options) => {
      requests.push({ url, ...options });
      return network(url, options);
    },
  });
  function load(specifier, parent = path.join(mobile, 'entry.ts')) {
    if (specifier === '@react-native-async-storage/async-storage') return { __esModule: true, default: asyncStorage };
    if (specifier === '@/lib/reportError') return { reportError: (...args) => errors.push(args) };
    if (specifier === '@/lib/offline/flushBus') return { notifyOfflineFlush() {} };
    let filename = specifier.startsWith('@/') ? path.join(mobile, specifier.slice(2)) : path.resolve(path.dirname(parent), specifier);
    if (!fs.existsSync(filename) || fs.statSync(filename).isDirectory()) {
      filename = [filename + '.ts', filename + '.tsx', path.join(filename, 'index.ts')].find(fs.existsSync);
    }
    assert.ok(filename && filename.startsWith(mobile + path.sep), `unexpected platform dependency: ${specifier}`);
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const output = transpile(fs.readFileSync(filename, 'utf8'), filename);
    const execute = vm.runInContext(`(function(require,module,exports){${output}\n})`, context, { filename });
    execute((child) => load(child, filename), module, module.exports);
    return module.exports;
  }
  const client = load('@/lib/api/client');
  client.setAccessToken('synthetic-test-bearer');
  return {
    api: load('@/lib/api/chats').chatsApi,
    queue: load('@/lib/offlineQueue'),
    policy: load('@/lib/api/chatCommands'),
    storage, requests, errors,
  };
}
const ok = (value = { id: 'one-message', payment_id: 'one-payment' }) => new Response(JSON.stringify(value), { status: 200 });
function invoke(h, kind, extra = {}) {
  if (kind === 'invoice') return h.api.invoiceFromChat('actor-A', 'project-A', 'thread-A', { title: 'Invoice', amount: 1000.25, payment_type: 'material', ...extra });
  return h.api.taskFromChatMessage('actor-A', 'project-A', 'thread-A', 'source-A', { title: 'Work', due_at: '2026-10-01', ...extra });
}

for (const kind of ['invoice', 'task']) {
  // The fake server commits the original body, then the client loses the response.
  const server = new Map();
  const storage = new Map();
  let lose = true;
  const network = async (_url, options) => {
    const body = JSON.parse(options.body);
    const key = body.client_request_id;
    assert.ok(key.length >= 8 && key.length <= 80);
    if (server.has(key)) assert.equal(server.get(key), options.body);
    else server.set(key, options.body);
    if (lose) { lose = false; throw new TypeError('Failed to fetch'); }
    return ok();
  };
  const first = harness({ storage, network });
  await assert.rejects(invoke(first, kind), /offline_queued/);
  const queued = await first.queue.getQueue();
  assert.equal(queued.length, 1);
  assert.equal(queued[0].body, first.requests[0].body);
  assert.equal(queued[0].userId, 'actor-A');
  const restart = harness({ storage, network });
  const result = await restart.queue.flush('http://127.0.0.1:8100');
  assert.equal(result.synced, 1);
  assert.equal((await restart.queue.getQueue()).length, 0);
  assert.equal(server.size, 1, 'restart replay must retain the original business identity');
  assert.equal(restart.requests[0].body, first.requests[0].body);
  scenarios += 1;

  for (const status of [400, 401, 403, 404, 409, 422]) {
    const h = harness({ network: async () => new Response(JSON.stringify({ detail: 'validation_failed' }), { status }) });
    await assert.rejects(invoke(h, kind), error => error.status === status);
    assert.equal((await h.queue.getQueue()).length, 0, `authoritative ${status} must not become queued network error`);
    scenarios += 1;
  }
  for (const status of [429, 500, 502, 503]) {
    const h = harness({ network: async () => new Response(JSON.stringify({ detail: 'temporary' }), { status }) });
    await assert.rejects(invoke(h, kind, { client_request_id: 'explicit-command-retry-key' }), /offline_queued/);
    assert.equal(JSON.parse((await h.queue.getQueue())[0].body).client_request_id, 'explicit-command-retry-key');
    scenarios += 1;
  }
  const corrupt = harness({ network: async () => new Response('{broken', { status: 200 }) });
  await assert.rejects(invoke(corrupt, kind), /offline_queued/);
  assert.equal((await corrupt.queue.getQueue()).length, 1);
  const failedStorage = harness({ failStorage: true, network: async () => { throw new TypeError('Failed to fetch'); } });
  await assert.rejects(invoke(failedStorage, kind), /storage_unavailable/);
  assert.equal(failedStorage.storage.size, 0, 'no durable queue success on failed persistence');
  const success = harness({ network: async () => ok() });
  assert.equal((await invoke(success, kind)).id, 'one-message');
  assert.equal((await success.queue.getQueue()).length, 0);
  assert.equal(success.policy.canQueueChatCommand(Object.assign(new Error('cancelled'), { name: 'AbortError' })), false);
  scenarios += 4;
}
console.log(`Chat command actual transport/queue contracts OK (${scenarios} scenarios; TypeScript ${ts.version}; diagnostic rejection canary passed; external providers disabled)`);
