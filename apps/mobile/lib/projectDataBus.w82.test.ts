/**
 * W82 syncProjectSideEffects — notify даже без user/project; с валидными — reload + notify.
 * Run: npx tsx apps/mobile/lib/projectDataBus.w82.test.ts
 */
import { notifyProjectDataChanged, subscribeProjectDataChanged, syncProjectSideEffects } from './projectDataBus';

async function main() {
  let n = 0;
  const count = () => n;
  const off = subscribeProjectDataChanged(() => {
    n += 1;
  });

  // Без user/project — только notify (не падаем)
  await syncProjectSideEffects({ user: null, project: null });
  if (count() !== 1) throw new Error(`expected 1 after empty sync, got ${count()}`);

  notifyProjectDataChanged();
  if (count() !== 2) throw new Error(`expected 2, got ${count()}`);

  off();
  notifyProjectDataChanged();
  if (count() !== 2) throw new Error(`expected still 2 after unsubscribe, got ${count()}`);

  console.log('projectDataBus.w82.test OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
