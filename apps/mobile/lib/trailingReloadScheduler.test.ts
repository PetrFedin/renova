import { createTrailingReloadScheduler } from './trailingReloadScheduler';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  let burstCalls = 0;
  const burst = createTrailingReloadScheduler(
    () => { burstCalls += 1; },
    { debounceMs: 8, maxWaitMs: 30 },
  );

  burst.schedule();
  burst.schedule();
  burst.schedule();
  await sleep(18);
  if (burstCalls !== 1) throw new Error(`burst must collapse to one call, got ${burstCalls}`);

  const firstRelease: { current: (() => void) | null } = { current: null };
  let trailingCalls = 0;
  const trailing = createTrailingReloadScheduler(
    async () => {
      trailingCalls += 1;
      if (trailingCalls === 1) {
        await new Promise<void>((resolve) => { firstRelease.current = resolve; });
      }
    },
    { debounceMs: 5, maxWaitMs: 20 },
  );

  trailing.flush();
  await sleep(2);
  trailing.schedule();
  trailing.schedule();
  firstRelease.current?.();
  await sleep(25);
  if (trailingCalls !== 2) throw new Error(`active reload must get one trailing call, got ${trailingCalls}`);

  let maxWaitCalls = 0;
  const maxWait = createTrailingReloadScheduler(
    () => { maxWaitCalls += 1; },
    { debounceMs: 12, maxWaitMs: 24 },
  );
  for (let i = 0; i < 6; i += 1) {
    maxWait.schedule();
    await sleep(5);
  }
  await sleep(8);
  if (maxWaitCalls < 1) throw new Error('continuous events must flush by maxWait');

  let cancelledCalls = 0;
  const cancelled = createTrailingReloadScheduler(
    () => { cancelledCalls += 1; },
    { debounceMs: 5, maxWaitMs: 10 },
  );
  cancelled.schedule();
  cancelled.cancel();
  await sleep(15);
  if (cancelledCalls !== 0) throw new Error('cancel must suppress pending work');

  burst.cancel();
  trailing.cancel();
  maxWait.cancel();
  console.log('trailingReloadScheduler.test OK');
}

void main();
