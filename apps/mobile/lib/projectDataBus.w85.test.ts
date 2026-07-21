/**
 * W85: шина side-effects без регрессий (portal callers reuse helper).
 * Run: npx tsx apps/mobile/lib/projectDataBus.w85.test.ts
 */
import { notifyProjectDataChanged, subscribeProjectDataChanged, syncProjectSideEffects } from './projectDataBus';

async function main() {
  let n = 0;
  const off = subscribeProjectDataChanged(() => {
    n += 1;
  });

  await syncProjectSideEffects({ user: null, project: null });
  await syncProjectSideEffects({
    user: { id: 'portal-u', role: 'customer' } as any,
    project: { id: 'portal-p' } as any,
    role: 'customer',
  });
  if (n < 2) throw new Error(`expected >=2, got ${n}`);

  off();
  const frozen = n;
  notifyProjectDataChanged();
  if (n !== frozen) throw new Error('listener leaked');

  console.log('projectDataBus.w85.test OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
