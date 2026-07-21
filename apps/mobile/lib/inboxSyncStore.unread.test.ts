/**
 * Store-protocol tests: stale reload, authoritative mark-read, dedup, visible thread.
 * Чистая модель (inboxSyncRevision) + in-memory симулятор API — без RN.
 * Run: npx tsx apps/mobile/lib/inboxSyncStore.unread.test.ts
 */
import {
  bumpMutationInvalidation,
  canApplyReload,
  createEventLru,
  nextReloadMeta,
  sumActiveUnread,
  totalAsIfThreadRead,
  type ReloadMeta,
  type RevisionState,
} from './inboxSyncRevision';
import { formatBadgeCount } from './formatUnreadMessagesRu';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

type Thread = { id: string; unread_count: number; is_archived?: boolean };

type MarkRes = {
  ok: true;
  thread_id: string;
  thread_unread_count: number;
  total_unread_count: number;
  read_at: string;
};

/** Минимальный симулятор store-контракта inboxSyncStore */
function createSim() {
  let threads: Thread[] = [];
  let chatCount = 0;
  let storeUserId: string | null = null;
  let rev: RevisionState = { serverRevision: 0, localMutationRevision: 0, reloadRequestSequence: 0 };
  let inflight: Promise<void> | null = null;
  let inflightMeta: ReloadMeta | null = null;
  let markFailed = false;
  const events = createEventLru();
  let visible: { id: string | null; focused: boolean; foreground: boolean } = {
    id: null, focused: false, foreground: false,
  };

  let apiInbox: () => Promise<Thread[]> = async () => threads;
  let apiMark: (tid: string) => Promise<MarkRes> = async () => {
    throw new Error('unset');
  };

  function applyLocal(threadId: string, unread: number) {
    threads = threads.map((t) => (t.id === threadId ? { ...t, unread_count: unread } : t));
    chatCount = sumActiveUnread(threads);
  }

  function applyAuth(threadId: string | undefined, threadUnread: number | undefined, total: number) {
    if (threadId && typeof threadUnread === 'number') {
      const exists = threads.some((t) => t.id === threadId);
      if (exists) {
        threads = threads.map((t) =>
          (t.id === threadId ? { ...t, unread_count: Math.max(0, threadUnread) } : t),
        );
      }
    }
    chatCount = Math.max(0, total);
    rev = { ...rev, serverRevision: rev.serverRevision + 1 };
  }

  async function requestSync(userId: string, force = false) {
    if (
      !force
      && inflight
      && inflightMeta
      && inflightMeta.userId === userId
      && inflightMeta.startedAtMutationRevision === rev.localMutationRevision
      && inflightMeta.requestSequence === rev.reloadRequestSequence
    ) {
      return inflight;
    }
    const stepped = nextReloadMeta(rev, userId);
    rev = stepped.state;
    const meta = stepped.meta;
    inflightMeta = meta;
    inflight = (async () => {
      if (storeUserId && storeUserId !== userId) {
        threads = [];
        chatCount = 0;
      }
      storeUserId = userId;
      const next = await apiInbox();
      if (!canApplyReload(meta, {
        storeUserId,
        reloadRequestSequence: rev.reloadRequestSequence,
        localMutationRevision: rev.localMutationRevision,
      })) {
        return;
      }
      threads = next;
      chatCount = sumActiveUnread(next);
      rev = { ...rev, serverRevision: rev.serverRevision + 1 };
    })();
    try {
      await inflight;
    } finally {
      if (inflightMeta?.requestSequence === meta.requestSequence) {
        inflight = null;
        inflightMeta = null;
      }
    }
  }

  async function markRead(userId: string, threadId: string): Promise<'confirmed' | 'reconciled' | 'failed'> {
    if (storeUserId && storeUserId !== userId) return 'failed';
    rev = bumpMutationInvalidation(rev);
    applyLocal(threadId, 0);
    markFailed = false;
    try {
      const res = await apiMark(threadId);
      applyAuth(res.thread_id || threadId, res.thread_unread_count, res.total_unread_count);
      return 'confirmed';
    } catch {
      try {
        await requestSync(userId, true);
        markFailed = false;
        return 'reconciled';
      } catch {
        markFailed = true;
        return 'failed';
      }
    }
  }

  function onWs(payload: {
    event_id?: string;
    thread_id?: string;
    thread_unread_count?: number;
    total_unread_count?: number;
  }) {
    if (payload.event_id && events.remember(payload.event_id)) return;
    if (typeof payload.total_unread_count !== 'number') return;
    const vis = visible.id === payload.thread_id && visible.focused && visible.foreground;
    if (vis) {
      applyAuth(
        payload.thread_id,
        0,
        totalAsIfThreadRead(payload.total_unread_count, payload.thread_unread_count ?? 0),
      );
      return;
    }
    applyAuth(payload.thread_id, payload.thread_unread_count, payload.total_unread_count);
  }

  return {
    get count() { return chatCount; },
    get threads() { return threads; },
    get markFailed() { return markFailed; },
    get rev() { return rev; },
    seed(userId: string, list: Thread[], count?: number) {
      storeUserId = userId;
      threads = list;
      chatCount = count ?? sumActiveUnread(list);
    },
    setApi(inbox: () => Promise<Thread[]>, mark: (tid: string) => Promise<MarkRes>) {
      apiInbox = inbox;
      apiMark = mark;
    },
    setVisible(id: string | null, focused: boolean, foreground: boolean) {
      visible = { id, focused, foreground };
    },
    requestSync,
    markRead,
    onWs,
  };
}

function defer<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

async function main() {
  // 1) stale reload ignored after optimistic mark-read
  {
    const s = createSim();
    s.seed('u1', [{ id: 'a', unread_count: 3 }, { id: 'b', unread_count: 2 }]);
    assert(s.count === 5, 'seed 5');

    const gate = defer<Thread[]>();
    let markResolve!: (v: MarkRes) => void;
    s.setApi(
      () => gate.promise,
      () => new Promise((res) => { markResolve = res; }),
    );

    const reloadP = s.requestSync('u1', true);
    const markP = s.markRead('u1', 'a');
    assert(s.count === 2, 'optimistic 2');

    gate.resolve([{ id: 'a', unread_count: 3 }, { id: 'b', unread_count: 2 }]);
    await reloadP;
    assert(s.count === 2, 'stale reload ignored');

    markResolve({
      ok: true, thread_id: 'a', thread_unread_count: 0, total_unread_count: 2, read_at: 't',
    });
    assert(await markP === 'confirmed', 'confirmed');
    assert(s.count === 2, 'authoritative 2');
  }

  // thread missing in snapshot — server total applied
  {
    const s = createSim();
    s.seed('u1', [{ id: 'b', unread_count: 2 }], 2);
    s.setApi(async () => s.threads, async () => ({
      ok: true, thread_id: 'missing', thread_unread_count: 0, total_unread_count: 7, read_at: 't',
    }));
    assert(await s.markRead('u1', 'missing') === 'confirmed', 'confirmed');
    assert(s.count === 7, 'server total');
  }

  // failure + reconcile
  {
    const s = createSim();
    s.seed('u1', [{ id: 'a', unread_count: 1 }, { id: 'b', unread_count: 1 }]);
    s.setApi(
      async () => [{ id: 'a', unread_count: 0 }, { id: 'b', unread_count: 1 }],
      async () => { throw new Error('net'); },
    );
    assert(await s.markRead('u1', 'a') === 'reconciled', 'reconciled');
    assert(s.count === 1, 'reconcile count');
    assert(s.markFailed === false, 'no fail flag');
  }

  // failure + failed reconcile
  {
    const s = createSim();
    s.seed('u1', [{ id: 'a', unread_count: 3 }]);
    s.setApi(
      async () => { throw new Error('down'); },
      async () => { throw new Error('net'); },
    );
    assert(await s.markRead('u1', 'a') === 'failed', 'failed');
    assert(s.markFailed === true, 'fail flag');
  }

  // user switch
  {
    const s = createSim();
    s.seed('u1', [{ id: 'a', unread_count: 4 }]);
    s.setApi(async () => [{ id: 'x', unread_count: 1 }], async () => {
      throw new Error('n/a');
    });
    await s.requestSync('u2', true);
    assert(s.count === 1, 'user switch');
  }

  // duplicate event
  {
    const s = createSim();
    s.seed('u1', [{ id: 'a', unread_count: 0 }], 0);
    s.onWs({ event_id: 'e1', thread_id: 'a', thread_unread_count: 1, total_unread_count: 1 });
    assert(s.count === 1, 'first');
    s.onWs({ event_id: 'e1', thread_id: 'a', thread_unread_count: 2, total_unread_count: 2 });
    assert(s.count === 1, 'dup ignored');
  }

  // focused foreground visible
  {
    const s = createSim();
    s.seed('u1', [{ id: 'a', unread_count: 0 }, { id: 'b', unread_count: 2 }], 2);
    s.setVisible('a', true, true);
    s.onWs({ event_id: 'v1', thread_id: 'a', thread_unread_count: 1, total_unread_count: 3 });
    assert(s.count === 2, 'as-if-read');
  }

  // background
  {
    const s = createSim();
    s.seed('u1', [{ id: 'a', unread_count: 0 }], 0);
    s.setVisible('a', true, false);
    s.onWs({ event_id: 'b1', thread_id: 'a', thread_unread_count: 1, total_unread_count: 1 });
    assert(s.count === 1, 'bg bump');
  }

  // unfocused mounted
  {
    const s = createSim();
    s.seed('u1', [{ id: 'a', unread_count: 0 }], 0);
    s.setVisible('a', false, true);
    s.onWs({ event_id: 'u1e', thread_id: 'a', thread_unread_count: 1, total_unread_count: 1 });
    assert(s.count === 1, 'unfocused bump');
  }

  // archived
  {
    const s = createSim();
    s.seed('u1', [
      { id: 'a', unread_count: 2 },
      { id: 'arch', unread_count: 9, is_archived: true },
    ]);
    assert(s.count === 2, 'archive excluded');
  }

  // 99+
  {
    assert(formatBadgeCount(120) === '99+', '99+');
    assert(formatBadgeCount(99) === '99', '99');
  }

  // two focus reloads join
  {
    const s = createSim();
    let calls = 0;
    const gate = defer<Thread[]>();
    s.setApi(async () => { calls += 1; return gate.promise; }, async () => {
      throw new Error('n/a');
    });
    const a = s.requestSync('u1');
    const b = s.requestSync('u1');
    gate.resolve([{ id: 'a', unread_count: 1 }]);
    await Promise.all([a, b]);
    assert(calls === 1, 'single inflight');
    assert(s.count === 1, 'joined result');
  }

  console.log('inboxSyncStore.unread.test OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
