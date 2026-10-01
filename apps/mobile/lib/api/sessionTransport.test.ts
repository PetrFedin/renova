/**
 * Сессия и транспорт клиента (аудит CMP-002/003/004/009/016/017/024).
 * fetch и хранилище подменены; без сети.
 */
import '@/lib/testing/asyncStorageMock';
process.env.EXPO_PUBLIC_API_URL ||= 'http://127.0.0.1:8100';

const must = (c: boolean, m: string) => {
  if (!c) throw new Error(m);
};
const tick = () => new Promise((r) => setTimeout(r, 0));

type Handler = (url: string, init: any) => Promise<any> | any;
let handler: Handler = () => json(200, {});
const calls: { url: string; init: any }[] = [];
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => ({
  ok: status < 400,
  status,
  text: async () => JSON.stringify(body),
  headers: { get: (k: string) => headers[k] ?? null },
});
(globalThis as any).fetch = async (url: string, init: any) => {
  calls.push({ url: String(url), init });
  return handler(String(url), init);
};
const bearer = (init: any) => init?.headers?.Authorization as string | undefined;

async function main() {
  const client = await import('./client');
  const authority = await import('@/lib/domain/sessionAuthority');
  const { memoryLocalStorage, resetMemoryStorage } = await import('@/lib/testing/asyncStorageMock');
  const { req, cachedGet, setAccessToken, setRefreshToken, getAccessToken, getRefreshToken, setSessionHooks } = client;

  const rotations: { access: string; refresh: string | null; gen: number }[] = [];
  let expired = 0;
  setSessionHooks({
    onTokensRotated: (t, stamp) => { rotations.push({ ...t, gen: stamp.generation }); },
    onSessionExpired: () => { expired += 1; },
  });
  const reset = (user: string | null = 'u1') => {
    calls.length = 0;
    rotations.length = 0;
    expired = 0;
    authority.beginSessionAuthority(user);
    setAccessToken('a1');
    setRefreshToken('r1');
  };

  // --- CMP-002: ротация refresh отдаётся владельцу сессии для записи в SecureStore ---
  reset();
  handler = (url, init) => {
    if (url.endsWith('/auth/refresh')) return json(200, { access_token: 'a2', refresh_token: 'r2' });
    return bearer(init) === 'Bearer a2' ? json(200, { ok: true }) : json(401, { detail: 'expired' });
  };
  await req('/api/v1/projects/p1/stages', {}, 'u1');
  must(rotations.length === 1 && rotations[0].access === 'a2' && rotations[0].refresh === 'r2', 'rotated tokens must reach the persistence hook');
  must(getAccessToken() === 'a2' && getRefreshToken() === 'r2', 'memory tokens rotated');
  must(expired === 0, 'successful refresh is not an expiry');

  // --- fencing: ответ refresh прежней сессии не публикуется и не доходит до хука ---
  reset();
  let releaseRefresh: () => void = () => undefined;
  handler = (url) => {
    if (url.endsWith('/auth/refresh')) {
      return new Promise((resolve) => {
        releaseRefresh = () => resolve(json(200, { access_token: 'OLD-a', refresh_token: 'OLD-r' }));
      });
    }
    return json(401, {});
  };
  const stale = client.refreshAccessToken();
  await tick();
  authority.beginSessionAuthority('u2');
  setAccessToken('b1');
  setRefreshToken('s1');
  releaseRefresh();
  must((await stale) === false, 'stale-generation refresh reports failure');
  must(getAccessToken() === 'b1' && getRefreshToken() === 's1', 'stale refresh must not overwrite the new session tokens');
  must(rotations.length === 0, 'stale refresh must not be persisted');

  // --- CMP-003: транзиентные сбои токены НЕ сбрасывают ---
  reset();
  handler = (url) => (url.endsWith('/auth/refresh') ? json(503, { detail: 'down' }) : json(401, {}));
  let threw = false;
  try { await req('/api/v1/projects', {}, 'u1'); } catch { threw = true; }
  must(threw, 'request fails while server is down');
  must(getAccessToken() === 'a1' && getRefreshToken() === 'r1', '5xx on refresh must keep tokens');
  must(expired === 0, '5xx on refresh is not a session expiry');

  handler = (url) => (url.endsWith('/auth/refresh') ? (() => { throw new TypeError('Network request failed'); })() : json(401, {}));
  threw = false;
  try { await req('/api/v1/projects', {}, 'u1'); } catch { threw = true; }
  must(threw && getRefreshToken() === 'r1' && expired === 0, 'network failure on refresh keeps tokens and does not expire');

  // --- CMP-003: окончательный отказ refresh — одно событие на сессию ---
  reset();
  handler = (url) => (url.endsWith('/auth/refresh') ? json(401, { detail: 'revoked' }) : json(401, {}));
  await Promise.allSettled([req('/api/v1/projects', {}, 'u1'), req('/api/v1/chats/inbox', {}, 'u1'), req('/api/v1/me', {}, 'u1')]);
  must(expired === 1, `authoritative refresh rejection fires session-expired once, got ${expired}`);
  must(getAccessToken() === null && getRefreshToken() === null, 'dead session tokens are cleared');
  calls.length = 0;
  await req('/api/v1/projects', {}, 'u1').catch(() => undefined);
  must(calls.every((c) => !c.url.endsWith('/auth/refresh')), 'no refresh storm with a dead token');

  // --- CMP-003: 401 и после успешного refresh ---
  reset();
  handler = (url) => (url.endsWith('/auth/refresh') ? json(200, { access_token: 'a2', refresh_token: 'r2' }) : json(401, { detail: 'session_revoked' }));
  threw = false;
  try { await req('/api/v1/projects', {}, 'u1'); } catch { threw = true; }
  must(threw && expired === 1, '401 after refresh ends the session');

  // 401 запроса прежней сессии (чужой userId, без Bearer) не разлогинивает новую
  reset('u2');
  handler = (url) => (url.endsWith('/auth/refresh') ? json(200, { access_token: 'a2', refresh_token: 'r2' }) : json(401, {}));
  await req('/api/v1/projects', {}, 'u-old').catch(() => undefined);
  must(expired === 0, 'unauthenticated stale-user request must not end the active session');

  // --- CMP-004: мутация сбрасывает кэш GET проекта и списки ---
  reset();
  resetMemoryStorage();
  let serverComments = 0;
  handler = (url, init) => {
    if (init?.method === 'POST') { serverComments += 1; return json(200, { id: 'c' }); }
    return json(200, { comments: serverComments });
  };
  must((await cachedGet<any>('/api/v1/projects/p1/stages/s1', 'u1')).comments === 0, 'initial');
  must((await cachedGet<any>('/api/v1/projects/p2/stages/s9', 'u1')).comments === 0, 'other project initial');
  must((await cachedGet<any>('/api/v1/projects', 'u1')).comments === 0, 'list initial');
  await req('/api/v1/projects/p1/stages/s1/comments', { method: 'POST', body: '{}' }, 'u1');
  must((await cachedGet<any>('/api/v1/projects/p1/stages/s1', 'u1')).comments === 1, 'stage cache must be dropped after a successful mutation');
  must((await cachedGet<any>('/api/v1/projects', 'u1')).comments === 1, 'project list cache must be dropped too');
  must((await cachedGet<any>('/api/v1/projects/p2/stages/s9', 'u1')).comments === 0, 'other project cache stays');

  // неуспешная мутация кэш не трогает
  const before = calls.length;
  handler = (url, init) => (init?.method === 'POST' ? json(422, { detail: 'bad' }) : json(200, { comments: 99 }));
  await req('/api/v1/projects/p1/stages/s1/comments', { method: 'POST', body: '{}' }, 'u1').catch(() => undefined);
  must((await cachedGet<any>('/api/v1/projects/p1/stages/s1', 'u1')).comments === 1, 'failed mutation must not invalidate');
  must(calls.length === before + 1, 'cached read after failed mutation is served from cache');

  // GET, начатый до мутации и закончившийся после, не кэшируется как свежий
  let release: () => void = () => undefined;
  handler = (url, init) => {
    if (init?.method === 'POST') return json(200, {});
    return new Promise((resolve) => { release = () => resolve(json(200, { comments: 'STALE' })); });
  };
  const racing = cachedGet<any>('/api/v1/projects/p3/stages/s1', 'u1');
  await tick();
  await req('/api/v1/projects/p3/stages/s1/comments', { method: 'POST', body: '{}' }, 'u1');
  release();
  await racing;
  handler = () => json(200, { comments: 'FRESH' });
  must((await cachedGet<any>('/api/v1/projects/p3/stages/s1', 'u1')).comments === 'FRESH', 'pre-mutation GET must not poison the TTL cache');

  // durable-копия устаревших данных тоже уходит
  resetMemoryStorage();
  handler = () => json(200, { v: 1 });
  await cachedGet('/api/v1/projects/p4/rooms', 'u1');
  must(memoryLocalStorage.getItem('renova_cache_get:u1:/api/v1/projects/p4/rooms') !== null, 'durable copy written');
  await req('/api/v1/projects/p4/rooms', { method: 'POST', body: '{}' }, 'u1');
  must(memoryLocalStorage.getItem('renova_cache_get:u1:/api/v1/projects/p4/rooms') === null, 'durable copy dropped after mutation');

  // --- CMP-016: выход чистит durable-кэш ---
  await cachedGet('/api/v1/projects', 'u1');
  memoryLocalStorage.setItem('renova_cache_rooms:p1:all', '[]');
  memoryLocalStorage.setItem('renova_user_role', 'customer');
  await client.clearAllCachedGets();
  must(memoryLocalStorage.getItem('renova_cache_get:u1:/api/v1/projects') === null, 'GET cache cleared on logout');
  must(memoryLocalStorage.getItem('renova_cache_rooms:p1:all') === null, 'rooms cache cleared on logout');
  must(memoryLocalStorage.getItem('renova_user_role') === 'customer', 'unrelated keys untouched');

  // --- CMP-024: отмена первого вызывателя не роняет остальных ---
  reset();
  calls.length = 0;
  let seenSignal: AbortSignal | null = null;
  let finish: () => void = () => undefined;
  handler = (url, init) => new Promise((resolve, reject) => {
    seenSignal = init.signal;
    init.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
    finish = () => resolve(json(200, { shared: true }));
  });
  const c1 = new AbortController();
  const p1 = req<any>('/api/v1/projects/p5/schedule', { signal: c1.signal }, 'u1');
  const p2 = req<any>('/api/v1/projects/p5/schedule', {}, 'u1');
  await tick();
  c1.abort();
  let e1: any;
  await p1.catch((e) => { e1 = e; });
  must(e1?.name === 'AbortError', 'aborted caller gets AbortError');
  must(!(seenSignal as AbortSignal | null)?.aborted, 'network request must survive while another caller waits');
  finish();
  must((await p2).shared === true, 'other waiter still receives the response');
  must(calls.filter((c) => c.url.includes('/p5/schedule')).length === 1, 'still a single network call');

  // все отменили -> сеть обрывается, без unhandled rejection
  const ca = new AbortController();
  const cb = new AbortController();
  const pa = req('/api/v1/projects/p6/schedule', { signal: ca.signal }, 'u1');
  const pb = req('/api/v1/projects/p6/schedule', { signal: cb.signal }, 'u1');
  await tick();
  ca.abort();
  must(!(seenSignal as AbortSignal | null)?.aborted, 'one of two aborted: network continues');
  cb.abort();
  await Promise.allSettled([pa, pb]);
  await tick();
  await tick();
  must((seenSignal as AbortSignal | null)?.aborted === true, 'all callers aborted: network request aborted');
  must(client.inFlightGetCount() === 0, 'aborted request released from the in-flight map');

  // --- CMP-009/017: портальный Bearer не подменяет глобальный и не теряется ---
  reset('u1');
  const unregister = client.registerPortalBearer('portal-user', 'PORTAL_JWT');
  must(client.authHeaders('portal-user').Authorization === 'Bearer PORTAL_JWT', 'guest request carries the portal bearer');
  must(client.authHeaders('u1').Authorization === 'Bearer a1', 'session user keeps own bearer');
  must(client.authHeaders().Authorization === 'Bearer a1', 'global token not replaced by portal token');
  must(getAccessToken() === 'a1', 'global access token untouched');
  authority.beginSessionAuthority(null);
  setAccessToken(null);
  must(client.authHeaders('portal-user').Authorization === 'Bearer PORTAL_JWT', 'guest without local session still authenticated');
  handler = (url, init) => json(200, { auth: bearer(init) });
  must((await req<any>('/api/v1/portal/projects/p1/snapshot', {}, 'portal-user')).auth === 'Bearer PORTAL_JWT', 'portal GET uses portal bearer');
  unregister();
  must(client.authHeaders('portal-user').Authorization === undefined, 'portal bearer removed when leaving the screen');

  // 401 портального запроса не трогает refresh/сессию пользователя
  reset('u1');
  client.registerPortalBearer('portal-user', 'PORTAL_JWT');
  handler = () => json(401, {});
  calls.length = 0;
  await req('/api/v1/portal/projects/p1/snapshot', {}, 'portal-user').catch(() => undefined);
  must(calls.every((c) => !c.url.endsWith('/auth/refresh')) && expired === 0, 'portal 401 neither refreshes nor ends the user session');

  console.log('sessionTransport.test OK');
}

main().catch((e) => { console.error(e); process.exit(1); });
