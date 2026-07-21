/**
 * W84: шина side-effects без регрессий (approvals/stage callers reuse helper).
 * Run: npx tsx apps/mobile/lib/projectDataBus.w84.test.ts
 */
import { notifyProjectDataChanged, subscribeProjectDataChanged, syncProjectSideEffects } from './projectDataBus';

async function main() {
  let n = 0;
  const off = subscribeProjectDataChanged(() => {
    n += 1;
  });

  await syncProjectSideEffects({ user: null, project: null });
  await syncProjectSideEffects({
    user: { id: 'u-w84', role: 'contractor' } as any,
    project: { id: 'p-w84' } as any,
    role: 'contractor',
  });
  if (n < 2) throw new Error(`expected >=2, got ${n}`);

  off();
  const frozen = n;
  notifyProjectDataChanged();
  if (n !== frozen) throw new Error('listener leaked after unsubscribe');

  console.log('projectDataBus.w84.test OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
