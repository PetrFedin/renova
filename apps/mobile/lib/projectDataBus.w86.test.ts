/**
 * W86: шина side-effects без регрессий.
 * Run: npx tsx apps/mobile/lib/projectDataBus.w86.test.ts
 */
import { notifyProjectDataChanged, subscribeProjectDataChanged, syncProjectSideEffects } from './projectDataBus';

async function main() {
  let n = 0;
  const off = subscribeProjectDataChanged(() => {
    n += 1;
  });
  await syncProjectSideEffects({ user: null, project: null });
  await syncProjectSideEffects({
    user: { id: 'u86', role: 'contractor' } as any,
    project: { id: 'p86' } as any,
    role: 'contractor',
  });
  if (n < 2) throw new Error(`expected >=2, got ${n}`);
  off();
  const frozen = n;
  notifyProjectDataChanged();
  if (n !== frozen) throw new Error('listener leaked');
  console.log('projectDataBus.w86.test OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
