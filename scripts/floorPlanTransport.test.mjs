#!/usr/bin/env node
/** Execute actual req -> floor API -> AsyncStorage queue -> restart/flush for floor plan and pin POSTs. */
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
    Error, TypeError, SyntaxError, Date, Math,
    process: { env: { EXPO_PUBLIC_APP_ENV: 'test', EXPO_PUBLIC_API_URL: 'http://127.0.0.1:8100' } },
  });
  context.fetch = async (url, options) => {
    requests.push({ url, ...options });
    return network(url, options);
  };
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
    api: load('@/lib/api/floor').floorApi,
    queue: load('@/lib/offlineQueue'),
    storage,
    requests,
    errors,
  };
}

const planBody = {
  name: 'Этаж 1',
  floor_level: 1,
  image_key: 'media/plan.jpg',
  width_px: 1600,
  height_px: 1200,
};
const pinBody = { room_id: 'room-A', x_pct: 30, y_pct: 60, label: 'Кухня' };
const okPlan = (value = { id: 'plan-1', ...planBody, image_url: '/api/v1/media/media/plan.jpg', pins: [], punch: [], created_at: '2026-09-17T10:00:00', replayed: false }) =>
  new Response(JSON.stringify(value), { status: 200 });
const okPin = (value = { id: 'pin-1', ...pinBody, replayed: false }) =>
  new Response(JSON.stringify(value), { status: 200 });

async function qualifyMutation({ name, prefix, invoke, okResponse, expectedPath, assertBody }) {
  let scenarios = 0;

  {
    const server = new Map();
    const storage = new Map();
    let lose = true;
    const network = async (url, options) => {
      assert.equal(new URL(url).pathname, expectedPath);
      const parsed = JSON.parse(options.body);
      const key = parsed.client_request_id;
      assert.ok(typeof key === 'string' && key.startsWith(prefix));
      assertBody(parsed);
      if (server.has(key)) assert.equal(server.get(key), options.body);
      else server.set(key, options.body);
      if (lose) { lose = false; throw new TypeError('Failed to fetch'); }
      return okResponse({ replayed: true });
    };
    const first = harness({ storage, network });
    await assert.rejects(invoke(first), /offline_queued/);
    const queued = await first.queue.getQueue();
    assert.equal(queued.length, 1, `${name}: lost response must queue one intent`);
    assert.equal(queued[0].body, first.requests[0].body, `${name}: queued bytes must equal first-send bytes`);
    assert.equal(queued[0].userId, 'actor-A');

    const restart = harness({ storage, network });
    const result = await restart.queue.flush('http://127.0.0.1:8100');
    assert.equal(result.synced, 1);
    assert.equal((await restart.queue.getQueue()).length, 0);
    assert.equal(server.size, 1);
    assert.equal(restart.requests[0].body, first.requests[0].body, `${name}: restart replay must be byte-identical`);
    scenarios += 1;
  }

  for (const status of [400, 401, 403, 404, 409, 422]) {
    const h = harness({ network: async () => new Response(JSON.stringify({ detail: 'authoritative' }), { status }) });
    await assert.rejects(invoke(h), error => error.status === status);
    assert.equal((await h.queue.getQueue()).length, 0, `${name}: authoritative ${status} must not queue`);
    scenarios += 1;
  }

  for (const status of [429, 500, 502, 503]) {
    const h = harness({ network: async () => new Response(JSON.stringify({ detail: 'temporary' }), { status }) });
    await assert.rejects(invoke(h), /offline_queued/);
    const queued = await h.queue.getQueue();
    assert.equal(queued.length, 1);
    assert.equal(queued[0].body, h.requests[0].body);
    assert.ok(JSON.parse(queued[0].body).client_request_id);
    scenarios += 1;
  }

  {
    const h = harness({ network: async () => { throw new TypeError('Failed to fetch'); } });
    await assert.rejects(invoke(h), /offline_queued/);
    const queued = await h.queue.getQueue();
    assert.equal(queued.length, 1);
    assert.equal(queued[0].body, h.requests[0].body);
    scenarios += 1;
  }

  {
    const h = harness({ network: async () => new Response('{broken-json', { status: 200 }) });
    await assert.rejects(invoke(h), /offline_queued/);
    const queued = await h.queue.getQueue();
    assert.equal(queued.length, 1);
    assert.equal(queued[0].body, h.requests[0].body);
    scenarios += 1;
  }

  {
    const failedStorage = harness({ failStorage: true, network: async () => { throw new TypeError('Failed to fetch'); } });
    await assert.rejects(invoke(failedStorage), /storage_unavailable/);
    assert.equal(failedStorage.storage.size, 0, `${name}: failed persistence must not claim durable queue success`);
    scenarios += 1;
  }

  {
    const success = harness({ network: async () => okResponse() });
    await invoke(success);
    assert.equal((await success.queue.getQueue()).length, 0);
    scenarios += 1;
  }

  {
    const success = harness({ network: async () => okResponse() });
    await invoke(success);
    await invoke(success);
    assert.equal(success.requests.length, 2);
    const firstId = JSON.parse(success.requests[0].body).client_request_id;
    const secondId = JSON.parse(success.requests[1].body).client_request_id;
    assert.notEqual(firstId, secondId, `${name}: deliberate equal-visible writes must have distinct intent IDs`);
    scenarios += 1;
  }

  assert.equal(scenarios, 16, `${name}: expected 16 transport scenarios`);
  return scenarios;
}

const planScenarios = await qualifyMutation({
  name: 'floor plan create',
  prefix: 'floor-plan-',
  expectedPath: '/api/v1/projects/project-A/floor-plans',
  invoke: h => h.api.createFloorPlan('actor-A', 'project-A', planBody),
  okResponse: override => okPlan({ id: 'plan-1', ...planBody, image_url: '/api/v1/media/media/plan.jpg', pins: [], punch: [], created_at: '2026-09-17T10:00:00', replayed: false, ...override }),
  assertBody: parsed => {
    assert.equal(parsed.name, planBody.name);
    assert.equal(parsed.image_key, planBody.image_key);
    assert.equal(parsed.floor_level, 1);
  },
});

const pinScenarios = await qualifyMutation({
  name: 'floor pin upsert',
  prefix: 'floor-pin-',
  expectedPath: '/api/v1/projects/project-A/floor-plans/plan-A/pins',
  invoke: h => h.api.pinFloorPlanRoom('actor-A', 'project-A', 'plan-A', pinBody),
  okResponse: override => okPin({ id: 'pin-1', ...pinBody, replayed: false, ...override }),
  assertBody: parsed => {
    assert.equal(parsed.room_id, 'room-A');
    assert.equal(parsed.x_pct, 30);
    assert.equal(parsed.y_pct, 60);
  },
});

console.log(`Floor-plan actual transport/queue contracts OK (${planScenarios + pinScenarios} scenarios; ${planScenarios} plan + ${pinScenarios} pin; TypeScript ${ts.version}; external providers disabled)`);
