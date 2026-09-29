import { nextBucketCount } from './bucketCountRead';

// #430: initial unknown must not be 0.
if (nextBucketCount(null, { ok: false }) !== null) throw new Error('failed read from unknown must stay unknown, not 0');

// #430: a failed read must not turn a confirmed count into 0.
if (nextBucketCount(5, { ok: false }) !== 5) throw new Error('failed read must preserve stale confirmed count, not collapse to 0');
if (nextBucketCount(0, { ok: false }) !== 0) throw new Error('failed read must preserve a genuinely confirmed 0');

// A successful empty response may become a confirmed 0.
if (nextBucketCount(null, { ok: true, count: 0 }) !== 0) throw new Error('successful empty read must confirm 0');

// A successful non-empty response exposes the exact count.
if (nextBucketCount(null, { ok: true, count: 3 }) !== 3) throw new Error('successful read must expose exact count');
if (nextBucketCount(3, { ok: true, count: 7 }) !== 7) throw new Error('successful reload must replace stale count with the fresh one');

console.log('bucketCountRead.test OK');
