#!/usr/bin/env node
/** Execute the real transpiled FloorPlanPanel queued-create branch with platform mocks. */
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
const filename = path.join(mobile, 'components/renova/FloorPlanPanel.tsx');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const compilerPath = path.relative(root, path.dirname(require.resolve('typescript/package.json'))).split(path.sep).join('/');
assert.equal(ts.version, lock.packages[compilerPath]?.version, 'UI harness must use the workspace TypeScript version');

const notifications = [];
const alerts = [];
const reports = [];
let createCalls = 0;
let syncCalls = 0;

const EmptyActionState = function EmptyActionState() {};
const stubComponent = name => Object.assign(function StubComponent() {}, { displayName: name });

const jsxRuntime = {
  Fragment: Symbol('Fragment'),
  jsx(type, props, key) { return { type, props: props ?? {}, key }; },
  jsxs(type, props, key) { return { type, props: props ?? {}, key }; },
};

const mocks = new Map([
  ['react', {
    useCallback: fn => fn,
    useEffect: () => undefined,
    useState: initial => [typeof initial === 'function' ? initial() : initial, () => undefined],
    useRef: initial => ({ current: initial }),
  }],
  ['react/jsx-runtime', jsxRuntime],
  ['react-native', {
    View: stubComponent('View'),
    Text: stubComponent('Text'),
    Image: stubComponent('Image'),
    Pressable: stubComponent('Pressable'),
    ActivityIndicator: stubComponent('ActivityIndicator'),
    StyleSheet: { create: value => value },
    PanResponder: { create: () => ({ panHandlers: {} }) },
    Alert: { alert: (...args) => alerts.push(args) },
  }],
  ['expo-router', {
    useLocalSearchParams: () => ({}),
    usePathname: () => '/object',
  }],
  ['expo-image-picker', {
    requestMediaLibraryPermissionsAsync: async () => ({ granted: true }),
    launchImageLibraryAsync: async () => ({ canceled: false, assets: [{ uri: 'file://floor-plan.jpg' }] }),
    launchCameraAsync: async () => ({ canceled: true, assets: [] }),
  }],
  ['@/lib/api', {
    api: {
      listFloorPlans: async () => [],
      moveFloorPin: async () => ({}),
      createIssue: async () => ({ id: 'issue-1' }),
      createFloorPlan: async () => {
        createCalls += 1;
        throw new Error('offline_queued');
      },
    },
  }],
  ['@/lib/context/RenovaContext', {
    useRenova: () => ({ user: { id: 'actor-A' }, activeProject: { id: 'project-A' } }),
  }],
  ['@/lib/projectDataBus', {
    syncProjectSideEffects: async () => { syncCalls += 1; },
  }],
  ['@/lib/useProjectDataReload', { useProjectDataReload: () => undefined }],
  ['@/lib/mediaUpload', { uploadMediaBlob: async () => 'media/floor-plan.jpg' }],
  ['@/lib/offlineUi', {
    isOfflineQueued: error => Boolean(error && error.message === 'offline_queued'),
    notifyOfflineQueued: label => notifications.push(label),
  }],
  ['@/components/renova/OfflineSyncStatus', { OfflineSyncStatus: stubComponent('OfflineSyncStatus') }],
  ['@/components/renova/FurnitureLayer', { FurnitureLayer: stubComponent('FurnitureLayer') }],
  ['@/components/renova/PrimaryButton', { PrimaryButton: stubComponent('PrimaryButton') }],
  ['@/lib/navigation', { pushRoomDetail: () => undefined }],
  ['@/constants/Theme', {
    RenovaTheme: {
      colors: {
        textMuted: '#777', dangerText: '#900', warningText: '#970', surface: '#fff', border: '#ddd',
        primary: '#06c', surfaceMuted: '#eee',
      },
    },
  }],
  ['@/lib/pushOsNav', { pushOsNav: () => undefined }],
  ['@/lib/qcNav', { openQcIssue: () => undefined }],
  ['@/components/renova/ActionConfirmSheet', { ActionConfirmSheet: stubComponent('ActionConfirmSheet') }],
  ['@/constants/osSections', { tabsRoute: () => '/tabs' }],
  ['@/lib/reportError', {
    reportCatch: () => error => reports.push(error),
    reportError: (...args) => reports.push(args),
  }],
  ['@/components/ui/LoadErrorState', { LoadErrorState: stubComponent('LoadErrorState') }],
  ['@/components/ui/EmptyActionState', { EmptyActionState }],
]);

const context = vm.createContext({
  console,
  setTimeout,
  clearTimeout,
  Error,
  TypeError,
  SyntaxError,
  Date,
  Math,
  Set,
  process: { env: { EXPO_PUBLIC_API_URL: 'http://127.0.0.1:8100' } },
});
context.fetch = async () => ({ blob: async () => ({ type: 'image/jpeg' }) });

function transpile(source, file) {
  const output = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
    },
    reportDiagnostics: true,
  });
  const diagnostics = (output.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error);
  assert.equal(diagnostics.length, 0, diagnostics.map(d => `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`).join('\n'));
  return output.outputText;
}

const source = fs.readFileSync(filename, 'utf8');
const output = transpile(source, filename);
const module = { exports: {} };
const execute = vm.runInContext(`(function(require,module,exports){${output}\n})`, context, { filename });
execute(specifier => {
  if (mocks.has(specifier)) return mocks.get(specifier);
  throw new Error(`unexpected UI dependency: ${specifier}`);
}, module, module.exports);

const tree = module.exports.FloorPlanPanel({
  userId: 'actor-A',
  projectId: 'project-A',
  role: 'contractor',
  embedded: false,
  roomsCount: 0,
});

function findElement(node, type) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === type) return node;
  const children = node.props?.children;
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    const found = findElement(child, type);
    if (found) return found;
  }
  return null;
}

const empty = findElement(tree, EmptyActionState);
assert.ok(empty, 'contractor empty state must expose the real uploadPlan action');
assert.equal(typeof empty.props.onAction, 'function');
empty.props.onAction();
await new Promise(resolve => setTimeout(resolve, 30));

assert.equal(createCalls, 1, 'queued upload must invoke floor-plan create once');
assert.deepEqual(notifications, ['Планировка'], 'queued create must show deferred-sync notification');
assert.equal(alerts.length, 0, 'queued create must not show retry-inducing upload error alert');
assert.equal(reports.length, 0, 'queued create is expected recovery, not an application error');
assert.equal(syncCalls, 0, 'postcommit side-effect sync must not run before queued create is actually committed');

console.log(`FloorPlanPanel queued-create UI contract OK (1 behavior; TypeScript ${ts.version}; no duplicate-retry alert)`);
