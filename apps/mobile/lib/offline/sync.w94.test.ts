/**
 * W94: queue mutations emit flushBus; payment/scan/conflicts/docs wired.
 * Run: npx tsx apps/mobile/lib/offline/sync.w94.test.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '../..');

const queue = readFileSync(join(root, 'lib/offlineQueue.ts'), 'utf8');
for (const fn of ['writeQueue', 'retryJob', 'dropJobsForProject']) {
  const idx = queue.indexOf(`export async function ${fn}`);
  if (idx < 0) throw new Error(`missing ${fn}`);
  const slice = queue.slice(idx, idx + 450);
  if (!slice.includes('emitQueueChanged')) {
    throw new Error(`${fn} must call emitQueueChanged`);
  }
}

const conflicts = readFileSync(join(root, 'app/_stack/conflicts.tsx'), 'utf8');
if (!conflicts.includes('writeQueue')) throw new Error('conflicts must use writeQueue');
if (conflicts.includes("renova_offline_queue")) {
  throw new Error('conflicts must not write AsyncStorage queue key directly');
}

const pay = readFileSync(join(root, 'app/payment-return.tsx'), 'utf8');
if (!pay.includes('syncProjectSideEffects')) throw new Error('payment-return missing sync');

const scan = readFileSync(join(root, 'app/scan-receipt.tsx'), 'utf8');
if (!scan.includes('syncProjectSideEffects')) throw new Error('scan-receipt missing sync');

const life = readFileSync(join(root, 'lib/hooks/useProjectLifecycleActions.ts'), 'utf8');
if (!life.includes('notifyProjectDataChanged')) throw new Error('lifecycle missing notify');

const docs = readFileSync(join(root, 'components/renova/DocumentsHub.tsx'), 'utf8');
if (!docs.includes('useProjectDataReload')) throw new Error('DocumentsHub missing reload hook');

console.log('offline sync.w94.test OK');
