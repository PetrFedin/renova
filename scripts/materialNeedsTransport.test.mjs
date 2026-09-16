#!/usr/bin/env node
/** Execute actual req -> materials API -> AsyncStorage queue -> flush in Node. */
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
assert.throws(() => transpile('export const broken = ;', 'invalid-canary.ts'), /TS\d+:/);

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
    api: load('@/lib/api/materials').materialsApi,
    queue: load('@/lib/offlineQueue'),
    storage,
    requests,
    errors,
  };
}

const ok = (value = { count: 1, created: [{ id: 'pick-1', name: 'Плитка' }], replayed: false }) =>
  new Response(JSON.stringify(value), { status: 200 });
const invoke = h => h.api.generateMaterialNeeds('actor-A', 'project-A');
let scenarios = 0;

// Lost response after the server accepted the exact intent; restart must replay the same bytes.
{
  const server = new Map();
  const storage = new Map();
  let lose = true;
  const network = async (_url, options) => {
    const body = JSON.parse(options.body);
    const key = body.client_request_id;
    assert.ok(typeof key === 'string' && key.length >= 8 && key.length <= 80);
    if (server.has(key)) assert.equal(server.get(key), options.body);
    else server.set(key, options.body);
    if (lose) { lose = false; throw new TypeError('Failed to fetch'); }
    return ok({ count: 1, created: [{ id: 'pick-1', name: 'Плитка' }], replayed: true });
  };
  const first = harness({ storage, network });
  await assert.rejects(invoke(first), /offline_queued/);
  const queued = await first.queue.getQueue();
  assert.equal(queued.length, 1);
  assert.equal(queued[0].body, first.requests[0].body);
  assert.equal(queued[0].userId, 'actor-A');

  const restart = harness({ storage, network });
  const result = await restart.queue.flush('http://127.0.0.1:8100');
  assert.equal(result.synced, 1);
  assert.equal((await restart.queue.getQueue()).length, 0);
  assert.equal(server.size, 1, 'restart replay must retain one logical material-needs intent');
  assert.equal(restart.requests[0].body, first.requests[0].body);
  scenarios += 1;
}

for (const status of [400, 401, 403, 404, 409, 422]) {
  const h = harness({ network: async () => new Response(JSON.stringify({ detail: 'authoritative' }), { status }) });
  await assert.rejects(invoke(h), error => error.status === status);
  assert.equal((await h.queue.getQueue()).length, 0, `authoritative ${status} must not queue`);
  scenarios += 1;
}

for (const status of [429, 500, 502, 503]) {
  const h = harness({ network: async () => new Response(JSON.stringify({ detail: 'temporary' }), { status }) });
  await assert.rejects(invoke(h), /offline_queued/);
  const queue = await h.queue.getQueue();
  assert.equal(queue.length, 1);
  assert.equal(queue[0].body, h.requests[0].body);
  assert.ok(JSON.parse(queue[0].body).client_request_id);
  scenarios += 1;
}

// A real fetch failure is normalized by production req() to transport status 0;
// the material producer must then preserve the exact original bytes durably.
{
  const h = harness({ network: async () => { throw new TypeError('Failed to fetch'); } });
  await assert.rejects(invoke(h), /offline_queued/);
  assert.equal((await h.queue.getQueue()).length, 1);
  assert.equal((await h.queue.getQueue())[0].body, h.requests[0].body);
  scenarios += 1;
}

// A 2xx response with an unreadable body is also response ambiguity: the
// server may already have committed, so replay must retain the same identity.
{
  const h = harness({ network: async () => new Response('{broken', { status: 200 }) });
  await assert.rejects(invoke(h), /offline_queued/);
  assert.equal((await h.queue.getQueue()).length, 1);
  assert.equal((await h.queue.getQueue())[0].body, h.requests[0].body);
  scenarios += 1;
}

{
  const failedStorage = harness({ failStorage: true, network: async () => { throw new TypeError('Failed to fetch'); } });
  await assert.rejects(invoke(failedStorage), /storage_unavailable/);
  assert.equal(failedStorage.storage.size, 0, 'failed persistence must not claim durable queue success');
  scenarios += 1;
}

{
  const success = harness({ network: async () => ok() });
  const result = await invoke(success);
  assert.equal(result.count, 1);
  assert.equal((await success.queue.getQueue()).length, 0);
  scenarios += 1;
}

// Two deliberate user actions with identical visible inputs are independent
// intents. The producer must mint a new identity per invocation, not derive it
// from project or estimate values.
{
  const success = harness({ network: async () => ok() });
  await invoke(success);
  await invoke(success);
  assert.equal(success.requests.length, 2);
  const firstId = JSON.parse(success.requests[0].body).client_request_id;
  const secondId = JSON.parse(success.requests[1].body).client_request_id;
  assert.ok(firstId);
  assert.ok(secondId);
  assert.notEqual(firstId, secondId);
  scenarios += 1;
}

console.log(`Material-needs actual transport/queue contracts OK (${scenarios} scenarios; TypeScript ${ts.version}; external providers disabled)`);
