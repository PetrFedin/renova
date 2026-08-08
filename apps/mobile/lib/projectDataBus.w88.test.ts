/**
 * W88: bus + runWith; bridge contract documented in useInboxTasks.
 * Run: npx tsx apps/mobile/lib/projectDataBus.w88.test.ts
 */
import {
  notifyProjectDataChanged,
  subscribeProjectDataChanged,
  syncProjectSideEffects,
  runWithProjectSideEffects,
} from './projectDataBus';

async function main() {
  let n = 0;
  const count = () => n;
  const off = subscribeProjectDataChanged(() => {
    n += 1;
  });

  notifyProjectDataChanged();
  if (count() !== 1) throw new Error(`notify expected 1, got ${count()}`);

  await syncProjectSideEffects({ user: null, project: null });
  if (count() !== 2) throw new Error(`sync empty expected 2, got ${count()}`);

  await runWithProjectSideEffects({ user: null, project: null }, async () => 88);
  if (count() !== 3) throw new Error(`runWith expected 3, got ${count()}`);

  off();
  const frozen = count();
  notifyProjectDataChanged();
  if (count() !== frozen) throw new Error('listener leaked');

  console.log('projectDataBus.w88.test OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
