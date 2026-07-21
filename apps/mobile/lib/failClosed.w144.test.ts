/** W144: fail-closed critical loads — no silent empty inbox/queue */
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..');
const must = (cond: boolean, msg: string) => {
  if (!cond) throw new Error(msg);
};

const chat = readFileSync(join(root, 'components/renova/chat/ChatThreadView.tsx'), 'utf8');
must(!chat.includes("chatInbox(user.id).catch(() => [])"), 'ChatThreadView: no silent empty inbox');
must(chat.includes("reportError('chat.resolveProjectId.inbox'"), 'ChatThreadView reports inbox errors');

const offline = readFileSync(join(root, 'components/renova/OfflineSyncStatus.tsx'), 'utf8');
must(offline.includes("reportError('offline.getQueue'"), 'OfflineSync reports queue errors');
must(!offline.includes("getQueue().catch(() => [])"), 'OfflineSync: no silent empty queue');

const stage = readFileSync(join(root, 'components/screens/StageDetailScreen.tsx'), 'utf8');
must(stage.includes("blocked: true, depends_on: 'load_error'"), 'StageDetail fail-closed on blocked load');

const bridge = readFileSync(join(root, '../../backend/app/services/ws_redis_bridge.py'), 'utf8');
must(bridge.includes('INSTANCE_ID'), 'ws redis bridge has instance id');
must(bridge.includes('redis_subscriber_loop'), 'ws redis bridge has subscriber loop');


const schedule = readFileSync(join(root, 'components/screens/schedule/UnifiedScheduleView.tsx'), 'utf8');
must(schedule.includes('useAsyncResource'), 'UnifiedScheduleView uses async resource');
must(!schedule.includes('setWorkOrders([])'), 'UnifiedScheduleView: no wipe workOrders on error');

const selections = readFileSync(join(root, 'components/screens/OsSelectionsScreen.tsx'), 'utf8');
must(!selections.includes('setItems([])'), 'OsSelectionsScreen: no setItems([]) on error');
must(selections.includes('useAsyncResource'), 'OsSelectionsScreen uses async resource');

console.log('failClosed.w144.test OK');
