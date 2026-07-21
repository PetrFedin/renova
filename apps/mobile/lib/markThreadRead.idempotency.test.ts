/**
 * Симуляция store-level coalesce (без сети).
 * Run: npx tsx apps/mobile/lib/markThreadRead.idempotency.test.ts
 */
import {
  clearMarkReadDiag,
  decideMarkReadAction,
  getMarkReadDiagSnapshot,
  recordMarkReadDiag,
} from './domain/markThreadReadPolicy';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function simulateStoreMark(opts: {
  threadId: string;
  throughMessageId: string;
  throughCreatedAt: string;
  confirmed: Map<string, { messageId: string; createdAt: string }>;
  inflight: Map<string, Promise<string>>;
  send: () => Promise<void>;
}): Promise<'sent' | 'deduplicated' | 'skipped_same' | 'skipped_stale'> {
  const conf = opts.confirmed.get(opts.threadId) ?? null;
  const d = decideMarkReadAction({
    throughMessageId: opts.throughMessageId,
    throughCreatedAt: opts.throughCreatedAt,
    confirmed: conf,
    hasInflight: opts.inflight.has(opts.threadId),
  });
  if (d.action === 'skip_same') {
    recordMarkReadDiag({
      threadId: opts.threadId,
      throughMessageId: opts.throughMessageId,
      source: 'thread_visible',
      outcome: 'skipped_same',
    });
    return 'skipped_same';
  }
  if (d.action === 'skip_stale') return 'skipped_stale';
  if (d.action === 'await_inflight') {
    recordMarkReadDiag({
      threadId: opts.threadId,
      throughMessageId: opts.throughMessageId,
      source: 'thread_visible',
      outcome: 'deduplicated',
    });
    await opts.inflight.get(opts.threadId);
    return 'deduplicated';
  }

  const p = (async () => {
    await opts.send();
    opts.confirmed.set(opts.threadId, {
      messageId: opts.throughMessageId,
      createdAt: opts.throughCreatedAt,
    });
    recordMarkReadDiag({
      threadId: opts.threadId,
      throughMessageId: opts.throughMessageId,
      source: 'thread_visible',
      outcome: 'sent',
    });
    return 'sent';
  })();
  opts.inflight.set(opts.threadId, p.then(() => opts.throughMessageId));
  try {
    await p;
    return 'sent';
  } finally {
    opts.inflight.delete(opts.threadId);
  }
}

async function main() {
  clearMarkReadDiag();
  let sends = 0;
  const confirmed = new Map<string, { messageId: string; createdAt: string }>();
  const inflight = new Map<string, Promise<string>>();
  const send = async () => {
    sends += 1;
    await Promise.resolve();
  };

  const a = simulateStoreMark({
    threadId: 't1',
    throughMessageId: 'm1',
    throughCreatedAt: '2024-01-02T00:00:00Z',
    confirmed,
    inflight,
    send,
  });
  const b = simulateStoreMark({
    threadId: 't1',
    throughMessageId: 'm1',
    throughCreatedAt: '2024-01-02T00:00:00Z',
    confirmed,
    inflight,
    send,
  });
  const [ra, rb] = await Promise.all([a, b]);
  assert(sends === 1, `one API send, got ${sends}`);
  assert(
    (ra === 'sent' && rb === 'deduplicated') || (rb === 'sent' && ra === 'deduplicated'),
    'one sent one dedup',
  );

  const before = sends;
  const rc = await simulateStoreMark({
    threadId: 't1',
    throughMessageId: 'm1',
    throughCreatedAt: '2024-01-02T00:00:00Z',
    confirmed,
    inflight,
    send,
  });
  assert(rc === 'skipped_same' && sends === before, 'refocus no send');

  const s2 = sends;
  await simulateStoreMark({
    threadId: 't2',
    throughMessageId: 'm9',
    throughCreatedAt: '2024-02-01T00:00:00Z',
    confirmed,
    inflight,
    send,
  });
  assert(sends === s2 + 1, 'other thread sends');

  // stale cursor
  const stale = await simulateStoreMark({
    threadId: 't1',
    throughMessageId: 'm0',
    throughCreatedAt: '2024-01-01T00:00:00Z',
    confirmed,
    inflight,
    send,
  });
  assert(stale === 'skipped_stale', 'stale skipped');

  const diag = getMarkReadDiagSnapshot();
  assert(diag.every((e) => e.threadId && e.outcome), 'diag present');

  console.log('markThreadRead.idempotency.test OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
