#!/usr/bin/env node
/** Execute actual req -> stages API -> AsyncStorage queue -> flush for #398. */
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
  const diagnostics = (output.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error);
  assert.equal(diagnostics.length, 0, `${filename}: ${diagnostics.map((d) => `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`).join('\n')}`);
  return output.outputText;
}
assert.throws(() => transpile('export const broken = ;', 'invalid-canary.ts'), /TS\d+:/);

function harness({ storage = new Map(), network, failStorage = false } = {}) {
  const requests = [];
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
    if (specifier === '@/lib/reportError') return { reportError() {} };
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
  return { api: load('@/lib/api/stages').stagesApi, queue: load('@/lib/offlineQueue'), storage, requests };
}

const ok = (value = { id: 'canonical-comment', text: 'Комментарий' }) => new Response(JSON.stringify(value), { status: 200 });
let scenarios = 0;

// Server commits, response disappears, restart flushes exact original intent.
{
  const server = new Map();
  const storage = new Map();
  let lose = true;
  const network = async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.text, 'Комментарий');
    assert.ok(body.client_request_id.length >= 8 && body.client_request_id.length <= 80);
    if (server.has(body.client_request_id)) assert.equal(server.get(body.client_request_id), options.body);
    else server.set(body.client_request_id, options.body);
    if (lose) { lose = false; throw new TypeError('Failed to fetch'); }
    return ok();
  };
  const first = harness({ storage, network });
  await assert.rejects(first.api.addStageComment('actor-A', 'project-A', 'stage-A', 'Комментарий'), /offline_queued/);
  const queued = await first.queue.getQueue();
  assert.equal(queued.length, 1);
  assert.equal(queued[0].body, first.requests[0].body, 'queue must retain exact first-attempt bytes');
  const restart = harness({ storage, network });
  const result = await restart.queue.flush('http://127.0.0.1:8100');
  assert.equal(result.synced, 1);
  assert.equal((await restart.queue.getQueue()).length, 0);
  assert.equal(server.size, 1);
  assert.equal(restart.requests[0].body, first.requests[0].body);
  scenarios += 1;
}

for (const status of [400, 401, 403, 404, 409, 422]) {
  const h = harness({ network: async () => new Response(JSON.stringify({ detail: 'rejected' }), { status }) });
  await assert.rejects(h.api.addStageComment('actor-A', 'project-A', 'stage-A', 'Комментарий'), (error) => error.status === status);
  assert.equal((await h.queue.getQueue()).length, 0, `authoritative ${status} must not be queued`);
  scenarios += 1;
}

for (const status of [429, 500, 502, 503]) {
  const h = harness({ network: async () => new Response(JSON.stringify({ detail: 'temporary' }), { status }) });
  await assert.rejects(h.api.addStageComment('actor-A', 'project-A', 'stage-A', 'Комментарий'), /offline_queued/);
  const queued = await h.queue.getQueue();
  assert.equal(queued.length, 1);
  assert.ok(JSON.parse(queued[0].body).client_request_id);
  scenarios += 1;
}

{
  const h = harness({ failStorage: true, network: async () => { throw new TypeError('Failed to fetch'); } });
  await assert.rejects(h.api.addStageComment('actor-A', 'project-A', 'stage-A', 'Комментарий'), /storage_unavailable/);
  assert.equal(h.storage.size, 0);
  scenarios += 1;
}

// Equal visible comments are separate user intents and therefore get separate ids.
{
  const bodies = [];
  const h = harness({ network: async (_url, options) => { bodies.push(JSON.parse(options.body)); return ok(); } });
  await h.api.addStageComment('actor-A', 'project-A', 'stage-A', 'Одинаково');
  await h.api.addStageComment('actor-A', 'project-A', 'stage-A', 'Одинаково');
  assert.notEqual(bodies[0].client_request_id, bodies[1].client_request_id);
  scenarios += 1;
}

console.log(`Stage-comment actual transport/queue contracts OK (${scenarios} scenarios; TypeScript ${ts.version})`);
