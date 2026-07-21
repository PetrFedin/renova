/**
 * W93: all app flush entrypoints use flushOfflineOutbox; enqueue emits flushBus.
 * Run: npx tsx apps/mobile/lib/offline/sync.w93.test.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '../..');

const layout = readFileSync(join(root, 'app/_layout.tsx'), 'utf8');
if (!layout.includes('flushOfflineOutbox')) throw new Error('_layout must use flushOfflineOutbox');
if (layout.includes("from '@/lib/offlineQueue'")) throw new Error('_layout must not import offlineQueue');

const ctx = readFileSync(join(root, 'lib/context/RenovaContext.tsx'), 'utf8');
if (!ctx.includes('flushOfflineOutbox')) throw new Error('RenovaContext must use flushOfflineOutbox');
if (ctx.includes("from '@/lib/offlineQueue'")) throw new Error('RenovaContext must not import offlineQueue');

const queue = readFileSync(join(root, 'lib/offlineQueue.ts'), 'utf8');
if (!queue.includes('emitQueueChanged')) throw new Error('offlineQueue missing emitQueueChanged');
if (!queue.includes('notifyOfflineFlush')) throw new Error('offlineQueue must notify flushBus');

for (const rel of [
  'app/_stack/checklist-templates.tsx',
  'app/(contractor)/_screens/subscription.tsx',
]) {
  const src = readFileSync(join(root, rel), 'utf8');
  if (!src.includes('useProjectDataReload')) {
    throw new Error(`missing useProjectDataReload: ${rel}`);
  }
}

console.log('offline sync.w93.test OK');
