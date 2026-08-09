/** W144: fail-closed critical loads and auth/demo surfaces. */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  OfflineQueueStorageError,
  parseOfflineQueueStorage,
} from './offlineQueueStorage';
import {
  isAuthoritativeRefreshRejection,
  shouldFallbackToDurableCache,
} from './api/failurePolicy';

const root = join(__dirname, '..');
const must = (cond: boolean, msg: string) => {
  if (!cond) throw new Error(msg);
};

const chat = readFileSync(join(root, 'components/renova/chat/ChatThreadView.tsx'), 'utf8');
must(!chat.includes("chatInbox(user.id).catch(() => [])"), 'ChatThreadView: no silent empty inbox');

const offline = readFileSync(join(root, 'components/renova/OfflineSyncStatus.tsx'), 'utf8');
must(offline.includes("reportError('offline.getQueue'"), 'OfflineSync reports queue errors');
must(!offline.includes("getQueue().catch(() => [])"), 'OfflineSync: no silent empty queue');
must(offline.includes('readError') && offline.includes('Повторить проверку'), 'OfflineSync exposes queue read failure and retry');
must(
  offline.includes('pending === 0 && blocked === 0 && conflicts === 0 && !readError'),
  'compact OfflineSync must stay visible when queue status cannot be read',
);

const queue = readFileSync(join(root, 'lib/offlineQueue.ts'), 'utf8');
must(queue.includes('return parseOfflineQueueStorage(raw, key);'), 'Offline queue storage parsing is fail-closed');
must(queue.includes('normalizeStoredJobs(raw, KEY)'), 'Offline queue rejects malformed stored jobs');
must(!queue.includes('export async function writeQueue'), 'Offline recovery cannot replace the whole queue from a stale UI snapshot');
must(queue.includes('export async function updateJobBody'), 'Conflict body update is atomic against latest queue');
must(queue.includes('export async function dedupeExactJobs'), 'Queue dedupe is atomic against latest queue');
const persistLegacyAt = queue.indexOf('await AsyncStorage.setItem(KEY, JSON.stringify(merged));');
const cleanupLegacyAt = queue.indexOf('await AsyncStorage.removeItem(key);');
must(
  persistLegacyAt >= 0 && cleanupLegacyAt > persistLegacyAt,
  'Legacy queue migration persists canonical data before deleting source storage',
);

must(parseOfflineQueueStorage(null, 'test').length === 0, 'Missing offline storage is a legitimate empty queue');
must(parseOfflineQueueStorage('[]', 'test').length === 0, 'Valid empty offline storage remains empty');
let invalidJsonRejected = false;
try {
  parseOfflineQueueStorage('{broken', 'test');
} catch (error) {
  invalidJsonRejected = error instanceof OfflineQueueStorageError && error.reason === 'invalid_json';
}
must(invalidJsonRejected, 'Malformed offline queue JSON must never become []');
let invalidShapeRejected = false;
try {
  parseOfflineQueueStorage('{"ok":true}', 'test');
} catch (error) {
  invalidShapeRejected = error instanceof OfflineQueueStorageError && error.reason === 'invalid_shape';
}
must(invalidShapeRejected, 'Non-array offline queue storage must never become []');

const conflicts = readFileSync(join(root, 'app/_stack/conflicts.tsx'), 'utf8');
must(conflicts.includes('loadError') && conflicts.includes('Повторить чтение'), 'Conflict recovery exposes storage read errors');
must(conflicts.includes('updateJobBody') && !conflicts.includes('writeQueue'), 'Conflict merge does not overwrite the whole queue');
must(conflicts.includes('dedupeExactJobs'), 'Conflict dedupe operates on the latest locked queue');
must(
  conflicts.includes('setJobs([])') && conflicts.includes('Never render/edit a stale snapshot'),
  'Conflict recovery never edits stale jobs after a failed read',
);

const stage = readFileSync(join(root, 'components/screens/StageDetailScreen.tsx'), 'utf8');
must(stage.includes("blocked: true, depends_on: 'load_error'"), 'StageDetail fail-closed on blocked load');

const roleScreen = readFileSync(join(root, 'app/onboarding/_screens/role.tsx'), 'utf8');
must(
  roleScreen.includes("const DEMO_LOGIN_ENABLED = (process.env.EXPO_PUBLIC_DEMO ?? '0') === '1';"),
  'Onboarding demo login must be disabled unless EXPO_PUBLIC_DEMO=1 is explicitly set',
);
must(
  !roleScreen.includes("process.env.EXPO_PUBLIC_DEMO ?? '1'"),
  'Onboarding must never default demo login to enabled',
);
must(
  roleScreen.includes('r.demo_code && DEMO_LOGIN_ENABLED'),
  'Preview OTP must never be rendered unless demo mode is explicitly enabled',
);
must(
  !roleScreen.includes('if (r.demo_code) setDemoCode(r.demo_code)'),
  'Preview OTP must not trust backend demo_code without the local demo gate',
);

const backendAuth = readFileSync(join(root, '../../backend/app/api/v1/auth.py'), 'utf8');
must(backendAuth.includes('if not _demo_endpoints_allowed():'), 'Backend demo endpoints must be environment-gated');
must(backendAuth.includes('raise HTTPException(404, "demo_disabled")'), 'Backend demo endpoints fail closed when disabled');

const bridge = readFileSync(join(root, '../../backend/app/services/ws_redis_bridge.py'), 'utf8');
must(bridge.includes('INSTANCE_ID'), 'ws redis bridge has instance id');
must(bridge.includes('redis_subscriber_loop'), 'ws redis bridge has subscriber loop');

// Auth refresh: only an authoritative 401/403 may invalidate a persisted session.
must(isAuthoritativeRefreshRejection(401), '401 refresh rejection is authoritative');
must(isAuthoritativeRefreshRejection(403), '403 refresh rejection is authoritative');
must(!isAuthoritativeRefreshRejection(0), 'network failure must not kill refresh session');
must(!isAuthoritativeRefreshRejection(429), 'rate limit must not kill refresh session');
must(!isAuthoritativeRefreshRejection(500), 'server failure must not kill refresh session');

// Durable GET cache: transient failures may use stale data, client/auth errors may not.
must(shouldFallbackToDurableCache({ status: 0, code: 'network' }), 'network failure may use durable cache');
must(shouldFallbackToDurableCache({ status: 0, code: 'timeout' }), 'timeout may use durable cache');
must(shouldFallbackToDurableCache({ status: 429, code: 'rate_limit' }), 'rate limit may use durable cache');
must(shouldFallbackToDurableCache({ status: 503 }), '5xx may use durable cache');
must(!shouldFallbackToDurableCache({ status: 401 }), '401 must not be hidden by stale cache');
must(!shouldFallbackToDurableCache({ status: 404 }), '404 must not be hidden by stale cache');

const apiClient = readFileSync(join(root, 'lib/api/client.ts'), 'utf8');
must(
  apiClient.includes('if (isAuthoritativeRefreshRejection(res.status))'),
  'Refresh clears credentials only through authoritative rejection policy',
);
must(
  apiClient.includes("throw new ApiError(502, 'Сервер не вернул новый токен доступа.'"),
  'Malformed successful refresh response must fail closed instead of becoming false/session-dead',
);
must(
  !apiClient.includes('catch {\n      return false;\n    } finally'),
  'Transient refresh exceptions must never silently become session-dead=false',
);

console.log('failClosed.w144.test OK');
