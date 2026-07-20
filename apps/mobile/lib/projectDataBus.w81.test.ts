/**
 * W81 project data bus.
 * Run: npx tsx apps/mobile/lib/projectDataBus.w81.test.ts
 */
import { notifyProjectDataChanged, subscribeProjectDataChanged } from './projectDataBus';

let n = 0;
const off = subscribeProjectDataChanged(() => { n += 1; });
notifyProjectDataChanged();
notifyProjectDataChanged();
off();
notifyProjectDataChanged();
if (n !== 2) throw new Error(`expected 2, got ${n}`);
console.log('projectDataBus.w81.test OK');
