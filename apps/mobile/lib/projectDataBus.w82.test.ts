/**
 * W82 syncProjectSideEffects — notify даже без user/project; с валидными — reload + notify.
 * Run: npx tsx apps/mobile/lib/projectDataBus.w82.test.ts
 */
import { notifyProjectDataChanged, subscribeProjectDataChanged, syncProjectSideEffects } from './projectDataBus';

async function main() {
  let n = 0;
  const off = subscribeProjectDataChanged(() => {
    n += 1;
  });

  // Без user/project — только notify (не падаем)
  await syncProjectSideEffects({ user: null, project: null });
  if (n !== 1) throw new Error(`expected 1 after empty sync, got ${n}`);

  notifyProjectDataChanged();
  if (n !== 2) throw new Error(`expected 2, got ${n}`);

  off();
  notifyProjectDataChanged();
  if (n !== 2) throw new Error(`expected still 2 after unsubscribe, got ${n}`);

  console.log('projectDataBus.w82.test OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
