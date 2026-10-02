import assert from 'node:assert/strict';
import { createTtlCache, mapWithConcurrency } from './limitedPool';

(async () => {
  let active = 0, peak = 0, calls = 0;
  const res = await mapWithConcurrency(Array.from({ length: 23 }, (_, i) => i), 3, async (n) => {
    calls++; active++; peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 2));
    active--; return n * 2;
  });
  assert.equal(peak, 3, 'parallelism capped at 3');
  assert.equal(calls, 23);
  assert.deepEqual(res.slice(0, 4), [0, 2, 4, 6], 'order preserved');

  let stop = false, started = 0;
  await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async () => { started++; stop = true; }, () => stop);
  assert.ok(started <= 2, 'stops issuing new work after cancel');

  let t = 0, loads = 0;
  const cache = createTtlCache<number>(1000, () => t);
  const load = async () => { loads++; return 7; };
  await Promise.all([cache.get('a', load), cache.get('a', load)]);
  assert.equal(loads, 1, 'in-flight dedupe');
  await cache.get('a', load); assert.equal(loads, 1, 'cache hit');
  t = 1500; await cache.get('a', load); assert.equal(loads, 2, 'ttl expiry');
  const bad = createTtlCache<number>(1000);
  await assert.rejects(bad.get('x', async () => { throw new Error('e'); }));
  assert.equal(bad.size(), 0, 'errors not cached');
  console.log('limitedPool.test OK');
})();
