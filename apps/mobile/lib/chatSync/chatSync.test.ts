/**
 * Chat sync orchestrator — fake timers + mock transport.
 * Run: npx tsx apps/mobile/lib/chatSync/chatSync.test.ts
 */
import { ChatSyncOrchestrator } from './orchestrator';
import type { ChatSyncClock, ChatSyncTransport, ChatSyncTransportArgs } from './types';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

type FakeTimer = { id: number; due: number; fn: () => void };

function createFakeClock() {
  let now = 1_000_000;
  let nextId = 1;
  const timers: FakeTimer[] = [];

  const clock: ChatSyncClock = {
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = nextId++;
      timers.push({ id, due: now + Math.max(0, ms), fn });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: (id) => {
      const n = id as unknown as number;
      const idx = timers.findIndex((t) => t.id === n);
      if (idx >= 0) timers.splice(idx, 1);
    },
  };

  async function advance(ms: number) {
    const target = now + ms;
    let guard = 0;
    while (guard++ < 100) {
      const due = timers.filter((t) => t.due <= target).sort((a, b) => a.due - b.due);
      if (!due.length) {
        now = target;
        return;
      }
      const next = due[0];
      now = next.due;
      clock.clearTimeout(next.id as unknown as ReturnType<typeof setTimeout>);
      next.fn();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    }
    throw new Error(`advance guard exceeded (timers=${timers.length})`);
  }

  return { clock, advance };
}

function createMockTransport() {
  const calls: ChatSyncTransportArgs[] = [];
  const threadCalls: Array<ChatSyncTransportArgs & { threadId: string }> = [];
  /** Запросы, ждущие ручного resolve (signal → авто-reject) */
  const waiting = new Set<{
    args: ChatSyncTransportArgs;
    resolve: () => void;
    reject: (e: Error) => void;
  }>();

  let gate = false;
  let shouldFail = false;

  const run = (args: ChatSyncTransportArgs) =>
    new Promise<void>((resolve, reject) => {
      calls.push(args);
      if (args.signal.aborted) {
        reject(new Error('aborted'));
        return;
      }
      const entry = {
        args,
        resolve: () => {
          waiting.delete(entry);
          args.signal.removeEventListener('abort', onAbort);
          if (shouldFail) reject(new Error('network'));
          else resolve();
        },
        reject: (e: Error) => {
          waiting.delete(entry);
          args.signal.removeEventListener('abort', onAbort);
          reject(e);
        },
      };
      const onAbort = () => entry.reject(new Error('aborted'));
      args.signal.addEventListener('abort', onAbort, { once: true });

      if (!gate) {
        queueMicrotask(() => entry.resolve());
      } else {
        waiting.add(entry);
      }
    });

  const transport: ChatSyncTransport = {
    syncAll: (args) => run(args),
    syncThread: (args) => {
      threadCalls.push(args);
      return run(args);
    },
  };

  return {
    transport,
    calls,
    threadCalls,
    /** true = не резолвить пока resolveAll */
    setGate: (v: boolean) => { gate = v; },
    setFail: (v: boolean) => { shouldFail = v; },
    resolveAll: () => {
      [...waiting].forEach((e) => e.resolve());
    },
    waitingCount: () => waiting.size,
  };
}

async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

async function main() {
  // 1. 10 WebSocket → 1 fetch
  {
    const fake = createFakeClock();
    const mock = createMockTransport();
    const orch = new ChatSyncOrchestrator({
      transport: mock.transport,
      clock: fake.clock,
      wsDebounceMs: 150,
      pollBaseMs: 999_999,
    });
    orch.setContext({ userId: 'u1', role: 'customer', projectId: 'p1' });
    for (let i = 0; i < 10; i++) orch.onInboxWsEvent();
    assert(mock.calls.length === 0, 'ws debounced');
    await fake.advance(150);
    await flush();
    assert(mock.calls.length === 1, `10 ws → 1, got ${mock.calls.length}`);
    assert(orch.getMetrics().coalescedRequests >= 9, 'coalesced');
    orch.dispose();
  }

  // 2. focus + WebSocket
  {
    const fake = createFakeClock();
    const mock = createMockTransport();
    mock.setGate(true);
    const orch = new ChatSyncOrchestrator({
      transport: mock.transport,
      clock: fake.clock,
      wsDebounceMs: 150,
      pollBaseMs: 999_999,
    });
    orch.setContext({ userId: 'u1', role: 'customer', projectId: 'p1' });
    const pFocus = orch.requestSync({ scope: 'all', reason: 'focus' });
    orch.onInboxWsEvent();
    await flush();
    assert(mock.calls.length === 1, 'focus one call');
    mock.resolveAll();
    await pFocus;
    await fake.advance(150);
    await flush();
    mock.setGate(false);
    mock.resolveAll();
    await flush();
    assert(mock.calls.length >= 1 && mock.calls.length <= 2, 'focus+ws');
    orch.dispose();
  }

  // 3. смена проекта во время fetch
  {
    const fake = createFakeClock();
    const mock = createMockTransport();
    mock.setGate(true);
    const orch = new ChatSyncOrchestrator({
      transport: mock.transport,
      clock: fake.clock,
      pollBaseMs: 999_999,
    });
    orch.setContext({ userId: 'u1', role: 'customer', projectId: 'p1' });
    const p1 = orch.requestSync({ scope: 'all', reason: 'manual', priority: 'high' });
    await flush();
    const key1 = mock.calls[0].contextKey;
    orch.setContext({ userId: 'u1', role: 'customer', projectId: 'p2' });
    const out = await p1;
    assert(
      out === 'cancelled' || out === 'failed' || out === 'dropped_stale_context',
      `project switch ${out}`,
    );
    const p2 = orch.requestSync({ scope: 'all', reason: 'project_change', priority: 'high' });
    await flush();
    mock.setGate(false);
    mock.resolveAll();
    assert((await p2) === 'applied', 'new project applied');
    assert(mock.calls.at(-1)!.contextKey !== key1, 'context key changed');
    orch.dispose();
  }

  // 4. logout во время fetch
  {
    const fake = createFakeClock();
    const mock = createMockTransport();
    mock.setGate(true);
    const orch = new ChatSyncOrchestrator({
      transport: mock.transport,
      clock: fake.clock,
      pollBaseMs: 999_999,
    });
    orch.setContext({ userId: 'u1', role: 'customer', projectId: 'p1' });
    const p = orch.requestSync({ scope: 'all', reason: 'manual' });
    await flush();
    orch.logout();
    const out = await p;
    assert(
      out === 'cancelled' || out === 'failed' || out === 'dropped_stale_context',
      `logout ${out}`,
    );
    assert((await orch.requestSync({ scope: 'all', reason: 'focus' })) === 'skipped_no_user', 'skip');
    orch.dispose();
  }

  // 5. reconnect
  {
    const fake = createFakeClock();
    const mock = createMockTransport();
    const orch = new ChatSyncOrchestrator({
      transport: mock.transport,
      clock: fake.clock,
      pollBaseMs: 999_999,
    });
    orch.setContext({ userId: 'u1', role: 'customer', projectId: 'p1' });
    orch.setInboxWsConnected(true);
    await flush();
    assert(mock.calls.filter((c) => c.reason === 'reconnect').length === 1, 'first recon');
    orch.setInboxWsConnected(false);
    orch.setInboxWsConnected(true);
    await flush();
    assert(orch.getMetrics().wsReconnects === 1, 'reconnect metric');
    assert(mock.calls.filter((c) => c.reason === 'reconnect').length === 2, 'second recon');
    orch.dispose();
  }

  // 6. offline flush coalesce
  {
    const fake = createFakeClock();
    const mock = createMockTransport();
    mock.setGate(true);
    const orch = new ChatSyncOrchestrator({
      transport: mock.transport,
      clock: fake.clock,
      pollBaseMs: 999_999,
    });
    orch.setContext({ userId: 'u1', role: 'customer', projectId: 'p1' });
    const a = orch.reconcileAfterOfflineFlush();
    const b = orch.reconcileAfterOfflineFlush();
    const c = orch.reconcileAfterOfflineFlush();
    await flush();
    assert(mock.calls.filter((x) => x.reason === 'offline_flush').length === 1, 'one flush');
    assert(orch.getMetrics().coalescedRequests >= 2, 'coalesced flush');
    mock.setGate(false);
    mock.resolveAll();
    await flush();
    mock.resolveAll();
    await Promise.all([a, b, c]);
    orch.dispose();
  }

  // 7. polling fallback
  {
    const fake = createFakeClock();
    const mock = createMockTransport();
    const orch = new ChatSyncOrchestrator({
      transport: mock.transport,
      clock: fake.clock,
      pollBaseMs: 1000,
      pollMaxMs: 8000,
    });
    orch.setContext({ userId: 'u1', role: 'customer', projectId: 'p1' });
    const before = mock.calls.length;
    await fake.advance(1000);
    await flush();
    assert(mock.calls.length > before, 'poll fired');
    assert(mock.calls.some((c) => c.reason === 'poll'), 'poll reason');
    orch.dispose();
  }

  // 8. медленный ответ отменён high-priority
  {
    const fake = createFakeClock();
    const mock = createMockTransport();
    mock.setGate(true);
    const orch = new ChatSyncOrchestrator({
      transport: mock.transport,
      clock: fake.clock,
      pollBaseMs: 999_999,
    });
    orch.setContext({ userId: 'u1', role: 'customer', projectId: 'p1' });
    const slow = orch.requestSync({ scope: 'all', reason: 'focus', priority: 'normal' });
    await flush();
    const fast = orch.requestSync({ scope: 'all', reason: 'manual', priority: 'high' });
    await flush();
    assert(orch.getMetrics().cancelledRequests >= 1, 'cancelled');
    mock.setGate(false);
    mock.resolveAll();
    const slowOut = await slow;
    const fastOut = await fast;
    assert(slowOut === 'cancelled' || slowOut === 'failed', `slow=${slowOut}`);
    assert(fastOut === 'applied', `fast=${fastOut}`);
    orch.dispose();
  }

  // 9. unmounted
  {
    const fake = createFakeClock();
    const mock = createMockTransport();
    const orch = new ChatSyncOrchestrator({
      transport: mock.transport,
      clock: fake.clock,
      pollBaseMs: 999_999,
    });
    orch.setContext({ userId: 'u1', role: 'customer', projectId: 'p1' });
    orch.setMounted(false);
    assert((await orch.requestSync({ scope: 'all', reason: 'focus' })) === 'skipped_unmounted', 'unmount');
    orch.dispose();
  }

  // 10. две вкладки (broadcast mock)
  {
    const fake = createFakeClock();
    const mock = createMockTransport();
    let handler: ((ev: { data: unknown }) => void) | null = null;
    const orch = new ChatSyncOrchestrator({
      transport: mock.transport,
      clock: fake.clock,
      pollBaseMs: 999_999,
      enableBroadcast: true,
      broadcastFactory: () => ({
        postMessage: () => {},
        get onmessage() {
          return handler;
        },
        set onmessage(fn) {
          handler = fn;
        },
        close: () => { handler = null; },
      }),
    });
    orch.setContext({ userId: 'u1', role: 'customer', projectId: 'p1' });
    handler?.({ data: { type: 'invalidate', contextKey: orch.getContextKey() } });
    await flush();
    assert(mock.calls.some((c) => c.reason === 'broadcast'), 'tab invalidate must keep broadcast reason');
    orch.dispose();
  }

  // thread coalesce
  {
    const fake = createFakeClock();
    const mock = createMockTransport();
    const orch = new ChatSyncOrchestrator({
      transport: mock.transport,
      clock: fake.clock,
      wsDebounceMs: 50,
      pollBaseMs: 999_999,
    });
    orch.setContext({ userId: 'u1', role: 'customer', projectId: 'p1' });
    orch.onThreadWsEvent('t1');
    orch.onThreadWsEvent('t1');
    await fake.advance(50);
    await flush();
    assert(mock.threadCalls.length === 1, 'thread coalesced');
    orch.dispose();
  }

  console.log('chatSync.test OK');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

setInterval(() => {}, 60_000);
