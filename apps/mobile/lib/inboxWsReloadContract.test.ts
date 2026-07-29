import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const src = (relativePath: string) => readFileSync(join(mobile, relativePath), 'utf8');
const must = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

const store = src('lib/inboxSyncStore.ts');
const scheduler = src('lib/trailingReloadScheduler.ts');
const bus = src('lib/inboxWsBus.ts');

must(store.includes('createTrailingReloadScheduler'), 'inbox WS must use shared trailing scheduler');
must(store.includes('WS_RELOAD_DEBOUNCE_MS') && store.includes('WS_RELOAD_MAX_WAIT_MS'), 'bounded WS reload window');
must(store.includes('reloadScheduler.schedule()'), 'WS messages must schedule, not reload immediately');
must(!store.includes("onReload();\n          emitInboxWs();"), 'raw WS message reload burst remains');
must(store.includes('reloadScheduler.flush();') && store.includes('ws.onopen'), 'reconnect catch-up refresh');
must(store.includes('reloadScheduler.cancel()'), 'WS teardown cancels queued work');
must(store.includes('POLL_CONNECTED_MS') && store.includes('POLL_DISCONNECTED_MS'), 'poll cadence has connected/disconnected modes');
must(store.includes('refreshPollCadence()'), 'poll cadence follows WS state');
must(store.includes('onReload: () => void | Promise<void>'), 'async reload callback supported');
must(scheduler.includes('maxWaitTimer') && scheduler.includes('trailing = true'), 'scheduler keeps max-wait and trailing state');
must(scheduler.includes('if (!active || !trailing) return'), 'scheduler suppresses work after cancel');
must(bus.includes('Array.from(listeners)'), 'WS listener dispatch uses stable snapshot');

console.log('inboxWsReloadContract.test OK');
