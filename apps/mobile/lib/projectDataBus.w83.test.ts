/**
 * W83: regression — шина side-effects стабильна (estimate/payment callers reuse W82 helper).
 * Run: npx tsx apps/mobile/lib/projectDataBus.w83.test.ts
 */
import { notifyProjectDataChanged, subscribeProjectDataChanged, syncProjectSideEffects } from './projectDataBus';

async function main() {
  let n = 0;
  const off = subscribeProjectDataChanged(() => {
    n += 1;
  });

  await syncProjectSideEffects({ user: null, project: null });
  await syncProjectSideEffects({
    user: { id: 'u1', role: 'customer' } as any,
    project: { id: 'p1' } as any,
  });
  // empty → notify; with ids → try reload (may fail in node) + notify
  if (n < 2) throw new Error(`expected >=2 notifies, got ${n}`);

  off();
  const before = n;
  notifyProjectDataChanged();
  if (n !== before) throw new Error('unsubscribed listener still fired');

  console.log('projectDataBus.w83.test OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
