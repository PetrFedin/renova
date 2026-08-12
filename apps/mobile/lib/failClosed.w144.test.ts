/** W144: fail-closed critical loads and auth/demo surfaces. */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  OfflineQueueStorageError,
  parseOfflineQueueStorage,
} from './offlineQueueStorage';
import {
  isAuthoritativeRefreshRejection,
  isAuthoritativeSessionFailure,
  shouldFallbackToDurableCache,
} from './api/failurePolicy';
import {
  parseSessionUserSnapshot,
  serializeSessionUserSnapshot,
} from './sessionSnapshot';
import type { User } from './api';

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

// Native credential storage: web may explicitly use AsyncStorage, native may not
// silently downgrade tokens/snapshots when SecureStore is unavailable or fails.
const secureTokenStore = readFileSync(join(root, 'lib/secureTokenStore.ts'), 'utf8');
must(
  secureTokenStore.includes("Platform.OS === 'web'") && secureTokenStore.includes('_store = asyncStore;'),
  'AsyncStorage credential storage is an explicit web-only platform decision',
);
must(
  secureTokenStore.includes("reportError('secureTokenStore.resolve'")
    && secureTokenStore.includes("reportError('secureTokenStore.operation'"),
  'Native secure-store resolution and operation failures are observable',
);
must(!secureTokenStore.includes('withStoreFallback'), 'Native secure storage must never use a fallback helper');
must(!secureTokenStore.includes('return op(asyncStore)'), 'Native secure-store operation failure must never retry in AsyncStorage');
must(
  secureTokenStore.includes("throw new Error('secure_store_unavailable')") && secureTokenStore.includes('throw normalized;'),
  'Unavailable/broken native secure storage must fail closed',
);

// WebSocket auth: a long-lived JWT may mint a short-lived ticket over HTTPS, but
// the JWT itself must never be placed in a URL. Ticket failure leaves WS closed;
// ChatThreadView already falls back to truthful polling while disconnected.
const wsAuth = readFileSync(join(root, 'lib/wsAuthQuery.ts'), 'utf8');
const chatWs = readFileSync(join(root, 'lib/useChatWebSocket.ts'), 'utf8');
must(wsAuth.includes('/api/v1/auth/ws-ticket'), 'WebSocket auth must mint a short-lived ticket');
must(wsAuth.includes("reportError('wsAuth.ticket'"), 'WebSocket ticket failures must be observable');
must(wsAuth.includes("throw new Error('ws_auth_access_token_missing')"), 'WebSocket auth must fail closed without an access token');
must(!wsAuth.includes('?token='), 'Long-lived JWT must never be embedded in a WebSocket URL');
must(
  wsAuth.includes('?ticket=') && wsAuth.includes('throw normalized;'),
  'Only a confirmed short-lived ticket may produce a WebSocket auth query',
);
must(
  chatWs.indexOf('const qs = await buildWsAuthQuery();') < chatWs.indexOf('const ws = new WebSocket('),
  'WebSocket must not be created until ticket mint succeeds',
);
must(
  chat.includes('useChatFallbackPoll(!wsConnected') && chat.includes("'○ опрос 15 с'"),
  'Ticket/WS failure must remain a truthful polling fallback, not fake online state',
);

// Auth refresh/bootstrap: only an authoritative 401/403 may invalidate a persisted session.
must(isAuthoritativeRefreshRejection(401), '401 refresh rejection is authoritative');
must(isAuthoritativeRefreshRejection(403), '403 refresh rejection is authoritative');
must(!isAuthoritativeRefreshRejection(0), 'network failure must not kill refresh session');
must(!isAuthoritativeRefreshRejection(429), 'rate limit must not kill refresh session');
must(!isAuthoritativeRefreshRejection(500), 'server failure must not kill refresh session');
must(isAuthoritativeSessionFailure({ status: 401 }), '401 bootstrap failure is authoritative');
must(!isAuthoritativeSessionFailure({ status: 0, code: 'network' }), 'network bootstrap failure preserves session');
must(!isAuthoritativeSessionFailure({ status: 503 }), '5xx bootstrap failure preserves session');

// Durable GET cache: transient failures may use stale data, client/auth errors may not.
must(shouldFallbackToDurableCache({ status: 0, code: 'network' }), 'network failure may use durable cache');
must(shouldFallbackToDurableCache({ status: 0, code: 'timeout' }), 'timeout may use durable cache');
must(shouldFallbackToDurableCache({ status: 429, code: 'rate_limit' }), 'rate limit may use durable cache');
must(shouldFallbackToDurableCache({ status: 503 }), '5xx may use durable cache');
must(!shouldFallbackToDurableCache({ status: 401 }), '401 must not be hidden by stale cache');
must(!shouldFallbackToDurableCache({ status: 404 }), '404 must not be hidden by stale cache');
must(!shouldFallbackToDurableCache({ status: 401, code: 'network' }), 'HTTP auth status wins over contradictory transient code');

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

// Offline identity snapshot must contain profile only, never access/refresh credentials.
const snapshotUser: User = {
  id: 'u-1',
  phone: '+70000000000',
  role: 'customer',
  full_name: 'Test User',
  inn: null,
  npd_verified: false,
  access_token: 'access-secret',
  refresh_token: 'refresh-secret',
  token_type: 'bearer',
};
const serializedSnapshot = serializeSessionUserSnapshot(snapshotUser);
must(!serializedSnapshot.includes('access-secret'), 'session snapshot strips access token');
must(!serializedSnapshot.includes('refresh-secret'), 'session snapshot strips refresh token');
const restoredSnapshot = parseSessionUserSnapshot(serializedSnapshot, { id: 'u-1', role: 'customer' });
must(restoredSnapshot?.id === 'u-1' && restoredSnapshot.role === 'customer', 'valid session snapshot restores identity');
must(!restoredSnapshot?.access_token && !restoredSnapshot?.refresh_token, 'restored snapshot never synthesizes credentials');
must(parseSessionUserSnapshot(serializedSnapshot, { id: 'other' }) === null, 'snapshot is bound to persisted user id');
must(parseSessionUserSnapshot(serializedSnapshot, { role: 'contractor' }) === null, 'snapshot is bound to persisted role');

const renovaContext = readFileSync(join(root, 'lib/context/RenovaContext.tsx'), 'utf8');
must(
  renovaContext.includes("userSnapshot: SESSION_USER_SNAPSHOT_KEY"),
  'RenovaContext persists a versioned offline identity snapshot',
);
must(
  renovaContext.includes("[KEYS.userRole, user.role]") && renovaContext.includes('serializeSessionUserSnapshot(user)'),
  'All successful session persistence stores role and safe identity snapshot together',
);
must(
  renovaContext.includes('if (!reachable) {\n          if (snapshot) applyDegradedIdentity(snapshot);\n          return;\n        }'),
  'Known-offline cold start restores identity without probing /me',
);
must(
  renovaContext.includes('if (!isAuthoritativeSessionFailure(error))'),
  'Transient bootstrap failures are classified before any destructive session reset',
);
const transientBranchAt = renovaContext.indexOf('if (!isAuthoritativeSessionFailure(error))');
const destructiveResetAt = renovaContext.indexOf('await AsyncStorage.multiRemove([', transientBranchAt);
must(
  transientBranchAt >= 0 && destructiveResetAt > transientBranchAt,
  'Session storage reset is reachable only after transient failure branch returns',
);
must(
  renovaContext.includes("setTeamAccess(u.role === 'contractor' ? UNRESOLVED_TEAM_ACCESS : NOT_APPLICABLE_TEAM_ACCESS)"),
  'Offline contractor identity remains write-blocked until team access is revalidated',
);
must(
  renovaContext.includes('await secureMultiRemove([KEYS.userSnapshot]);'),
  'Authoritative logout/session rejection deletes persisted identity snapshot',
);

console.log('failClosed.w144.test OK');
