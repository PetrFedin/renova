/**
 * W89: useProjectDataReload — reload on projectDataBus notify.
 * Run: npx tsx apps/mobile/lib/useProjectDataReload.w89.test.ts
 */
import { notifyProjectDataChanged, subscribeProjectDataChanged } from './projectDataBus';

// Mirror hook contract without RN: subscribe → notify → callback
let n = 0;
const reload = () => {
  n += 1;
};
const off = subscribeProjectDataChanged(reload);
notifyProjectDataChanged();
notifyProjectDataChanged();
off();
notifyProjectDataChanged();
if (n !== 2) throw new Error(`expected 2 reloads, got ${n}`);
console.log('useProjectDataReload.w89.test OK');
