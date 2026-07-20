/**
 * W79 flush bus.
 * Run: npx tsx apps/mobile/lib/offline/flushBus.w79.test.ts
 */
import { notifyOfflineFlush, subscribeOfflineFlush } from './flushBus';

let n = 0;
const off = subscribeOfflineFlush(() => { n += 1; });
notifyOfflineFlush();
notifyOfflineFlush();
off();
notifyOfflineFlush();
if (n !== 2) throw new Error(`expected 2 notifies, got ${n}`);
console.log('flushBus.w79.test OK');
