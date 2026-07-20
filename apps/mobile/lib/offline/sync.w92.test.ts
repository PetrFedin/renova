/**
 * W92: flushOfflineOutbox notifies projectDataBus when synced>0.
 * Run: npx tsx apps/mobile/lib/offline/sync.w92.test.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, 'sync.ts'), 'utf8');
for (const needle of [
  "import { notifyProjectDataChanged } from '@/lib/projectDataBus'",
  'if (synced > 0)',
  'notifyProjectDataChanged()',
]) {
  if (!src.includes(needle)) throw new Error(`W92 sync.ts missing: ${needle}`);
}

const banner = readFileSync(join(__dirname, '../../components/renova/OfflineSyncBanner.tsx'), 'utf8');
if (!banner.includes('flushOfflineOutbox')) throw new Error('banner must use flushOfflineOutbox');
if (banner.includes('from \'@/lib/offlineQueue\'') && banner.includes('flush,')) {
  throw new Error('banner must not call raw flush');
}
if (!banner.includes('subscribeOfflineFlush')) throw new Error('banner missing subscribeOfflineFlush');

const conflicts = readFileSync(join(__dirname, '../../app/_stack/conflicts.tsx'), 'utf8');
if (!conflicts.includes('flushOfflineOutbox')) throw new Error('conflicts must use flushOfflineOutbox');

console.log('offline sync.w92.test OK');
