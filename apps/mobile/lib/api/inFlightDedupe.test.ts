/**
 * Concurrent GETs to the same URL must reach the network once.
 *
 * One Home render issues ~200 requests and the same URL repeats up to a dozen
 * times inside a single burst: several widgets independently ask for
 * /chats/inbox, /payments, /work-acceptances/pending-count, /material-picks and
 * /floor-plans for the same project at the same moment. Only 5 of 245 API
 * methods go through `cachedGet`; the rest call `req` directly, so nothing
 * collapsed them.
 *
 * Merging *in-flight* requests costs nothing in freshness — the callers would
 * have received the same response anyway, at the same moment — unlike a TTL
 * cache, which would serve stale data after a write.
 */
process.env.EXPO_PUBLIC_API_URL ||= 'http://127.0.0.1:8100';

const must = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

type FetchCall = { url: string; method: string };

const calls: FetchCall[] = [];
let resolveGate: (() => void) | null = null;

const gate = new Promise<void>((resolve) => {
  resolveGate = resolve;
});

(globalThis as any).fetch = async (input: any, init?: any) => {
  calls.push({
    url: typeof input === 'string' ? input : String(input?.url ?? ''),
    method: (init?.method as string) || 'GET',
  });
  // Hold every request open so concurrency is real rather than accidental.
  await gate;
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ ok: true, seq: calls.length }),
    headers: { get: () => null },
  } as any;
};

async function run() {
  const { req, inFlightGetCount } = await import('./client');

  // --- concurrent identical GETs collapse to one network call ---
  const burst = Promise.all([
    req('/api/v1/chats/inbox', {}, 'user-1'),
    req('/api/v1/chats/inbox', {}, 'user-1'),
    req('/api/v1/chats/inbox', {}, 'user-1'),
    req('/api/v1/chats/inbox', {}, 'user-1'),
  ]);
  await new Promise((r) => setTimeout(r, 0));
  must(
    calls.filter((c) => c.url.includes('/chats/inbox')).length === 1,
    `four concurrent identical GETs must issue one request, issued ${calls.length}`,
  );
  must(inFlightGetCount() === 1, 'exactly one GET should be tracked as in flight');

  // --- a different user is a different request ---
  const otherUser = req('/api/v1/chats/inbox', {}, 'user-2');
  await new Promise((r) => setTimeout(r, 0));
  must(
    calls.filter((c) => c.url.includes('/chats/inbox')).length === 2,
    'the auth header changes the response, so userId must be part of the key',
  );

  // --- a different path is a different request ---
  const otherPath = req('/api/v1/projects', {}, 'user-1');
  await new Promise((r) => setTimeout(r, 0));
  must(
    calls.filter((c) => c.url.includes('/api/v1/projects')).length === 1,
    'a different path must not be merged',
  );

  // --- a mutation is an intent and must never be merged ---
  const writes = Promise.all([
    req('/api/v1/projects/p1/payments', { method: 'POST', body: '{}' }, 'user-1'),
    req('/api/v1/projects/p1/payments', { method: 'POST', body: '{}' }, 'user-1'),
  ]);
  await new Promise((r) => setTimeout(r, 0));
  must(
    calls.filter((c) => c.method === 'POST').length === 2,
    'two POSTs are two intents and must both reach the server',
  );

  resolveGate?.();
  const results = await burst;
  await otherUser;
  await otherPath;
  await writes;

  // --- every caller of the merged request gets the same answer ---
  must(results.length === 4, 'all four callers must settle');
  const first = JSON.stringify(results[0]);
  must(
    results.every((r) => JSON.stringify(r) === first),
    'merged callers must observe identical data',
  );

  // --- the key is released, so a later call hits the network again ---
  must(inFlightGetCount() === 0, 'settled requests must be removed from the map');
  await req('/api/v1/chats/inbox', {}, 'user-1');
  must(
    calls.filter((c) => c.url.includes('/chats/inbox')).length === 3,
    'a request made after the previous one settled must not be served from the map',
  );

  console.log('inFlightDedupe.test OK');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
