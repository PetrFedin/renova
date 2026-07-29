import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const bus = readFileSync(join(mobile, 'lib/projectDataBus.ts'), 'utf8');
const must = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

must(bus.includes('SIDE_EFFECT_COALESCE_MS = 300'), 'side effect cooldown');
must(bus.includes('const activeSyncs = new Map'), 'active sync map');
must(bus.includes('const scheduledSyncs = new Map'), 'scheduled trailing sync map');
must(bus.includes('const lastCompletedAt = new Map'), 'completed timestamp map');
must(bus.includes('active.latest = opts') && bus.includes('active.dirty = true'), 'inflight burst keeps latest context');
must(bus.includes('do {') && bus.includes('} while (state.dirty)'), 'dirty sync receives trailing refresh');
must(bus.includes('scheduled.latest = opts'), 'cooldown burst updates scheduled context');
must(bus.includes('startSync(context.key, entry.latest)'), 'scheduled refresh uses latest context');
must(bus.includes('lastCompletedAt.set(key, Date.now())'), 'cooldown begins after completed refresh');
must(bus.includes('reloadInboxSync') && bus.includes('notifyProjectDataChanged'), 'inbox and screen invalidation retained');
must(bus.includes('[...listeners].forEach'), 'listener snapshot prevents mutation during dispatch');
must(bus.includes('if (!user?.id || !project?.id) return null'), 'missing context remains fail-safe');
must(bus.includes('await syncProjectSideEffects(opts)'), 'runWithProjectSideEffects still awaits final trailing refresh');

console.log('projectSideEffectsCoalescing.test OK');
