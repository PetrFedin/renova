/**
 * Bounded one-shot handoff for authoritative mark-read totals.
 * Run: npx tsx apps/mobile/lib/domain/markReadAuthoritativeTotal.test.ts
 */
import {
  clearMarkReadAuthoritativeTotals,
  consumeMarkReadAuthoritativeTotal,
  stageMarkReadAuthoritativeTotal,
} from './markReadAuthoritativeTotal';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

// Invalid response for the same thread clears an older staged value.
{
  clearMarkReadAuthoritativeTotals();
  stageMarkReadAuthoritativeTotal('thread-a', 8, 1_000);
  stageMarkReadAuthoritativeTotal('thread-a', undefined, 1_001);
  assert(
    consumeMarkReadAuthoritativeTotal('thread-a', 1_001) === undefined,
    'missing total clears stale handoff',
  );
}

// Capacity is enforced after insertion: the oldest of 101 entries is evicted.
{
  clearMarkReadAuthoritativeTotals();
  for (let index = 0; index <= 100; index += 1) {
    stageMarkReadAuthoritativeTotal(`thread-${index}`, index, 2_000);
  }
  assert(
    consumeMarkReadAuthoritativeTotal('thread-0', 2_000) === undefined,
    'oldest entry evicted at capacity',
  );
  assert(
    consumeMarkReadAuthoritativeTotal('thread-1', 2_000) === 1,
    'next entry retained at capacity',
  );
  assert(
    consumeMarkReadAuthoritativeTotal('thread-100', 2_000) === 100,
    'newest entry retained at capacity',
  );
}

// Restaging a thread refreshes insertion order, so an older different thread is evicted.
{
  clearMarkReadAuthoritativeTotals();
  stageMarkReadAuthoritativeTotal('thread-a', 1, 3_000);
  stageMarkReadAuthoritativeTotal('thread-b', 2, 3_000);
  stageMarkReadAuthoritativeTotal('thread-a', 3, 3_001);
  for (let index = 0; index < 99; index += 1) {
    stageMarkReadAuthoritativeTotal(`thread-extra-${index}`, index, 3_001);
  }
  assert(
    consumeMarkReadAuthoritativeTotal('thread-b', 3_001) === undefined,
    'oldest non-refreshed entry evicted',
  );
  assert(
    consumeMarkReadAuthoritativeTotal('thread-a', 3_001) === 3,
    'restaged entry retained with latest total',
  );
}

// TTL is inclusive at 30 seconds and expired immediately after it.
{
  clearMarkReadAuthoritativeTotals();
  stageMarkReadAuthoritativeTotal('thread-boundary', 4, 4_000);
  assert(
    consumeMarkReadAuthoritativeTotal('thread-boundary', 34_000) === 4,
    'handoff valid at ttl boundary',
  );

  stageMarkReadAuthoritativeTotal('thread-expired', 5, 4_000);
  assert(
    consumeMarkReadAuthoritativeTotal('thread-expired', 34_001) === undefined,
    'handoff expires after ttl boundary',
  );
}

// Thread ids and totals are normalized; consumption remains one-shot.
{
  clearMarkReadAuthoritativeTotals();
  stageMarkReadAuthoritativeTotal('  thread-normalized  ', 6.9, 5_000);
  assert(
    consumeMarkReadAuthoritativeTotal('thread-normalized', 5_000) === 6,
    'id trimmed and total truncated',
  );
  assert(
    consumeMarkReadAuthoritativeTotal('thread-normalized', 5_000) === undefined,
    'handoff consumed once',
  );
}

clearMarkReadAuthoritativeTotals();
console.log('markReadAuthoritativeTotal.test OK');
