/** W144: fail-closed critical loads and auth/demo surfaces. */
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..');
const must = (cond: boolean, msg: string) => {
  if (!cond) throw new Error(msg);
};

const chat = readFileSync(join(root, 'components/renova/chat/ChatThreadView.tsx'), 'utf8');
must(!chat.includes("chatInbox(user.id).catch(() => [])"), 'ChatThreadView: no silent empty inbox');

const offline = readFileSync(join(root, 'components/renova/OfflineSyncStatus.tsx'), 'utf8');
must(offline.includes("reportError('offline.getQueue'"), 'OfflineSync reports queue errors');
must(!offline.includes("getQueue().catch(() => [])"), 'OfflineSync: no silent empty queue');

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

const backendAuth = readFileSync(join(root, '../../backend/app/api/v1/auth.py'), 'utf8');
must(backendAuth.includes('if not _demo_endpoints_allowed():'), 'Backend demo endpoints must be environment-gated');
must(backendAuth.includes('raise HTTPException(404, "demo_disabled")'), 'Backend demo endpoints fail closed when disabled');

const bridge = readFileSync(join(root, '../../backend/app/services/ws_redis_bridge.py'), 'utf8');
must(bridge.includes('INSTANCE_ID'), 'ws redis bridge has instance id');
must(bridge.includes('redis_subscriber_loop'), 'ws redis bridge has subscriber loop');

console.log('failClosed.w144.test OK');
