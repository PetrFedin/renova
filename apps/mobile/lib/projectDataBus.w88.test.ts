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
  const off = subscribeProjectDataChanged(() => {
    n += 1;
  });

  notifyProjectDataChanged();
  if (n !== 1) throw new Error(`notify expected 1, got ${n}`);

  await syncProjectSideEffects({ user: null, project: null });
  if (n !== 2) throw new Error(`sync empty expected 2, got ${n}`);

  await runWithProjectSideEffects({ user: null, project: null }, async () => 88);
  if (n !== 3) throw new Error(`runWith expected 3, got ${n}`);

  off();
  const frozen = n;
  notifyProjectDataChanged();
  if (n !== frozen) throw new Error('listener leaked');

  console.log('projectDataBus.w88.test OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
