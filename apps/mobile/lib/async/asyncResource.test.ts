/**
 * AsyncResource state machine — все сценарии честности.
 * Run: npx tsx apps/mobile/lib/async/asyncResource.test.ts
 */
import { normalizeAppError } from './appError';
import {
  idleAsyncResource,
  reduceAsyncResource,
  asyncShowEmpty,
  asyncShowError,
  asyncShowStale,
  asyncIsLoading,
  type AsyncResource,
} from './asyncResource';

/** Минимальный duck-type как ApiError (без path alias в tsx) */
class FakeApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const KEY = 'proj:a';
const KEY_B = 'proj:b';

function step<T>(
  state: AsyncResource<T>,
  event: Parameters<typeof reduceAsyncResource<T>>[1],
): AsyncResource<T> {
  return reduceAsyncResource(state, event);
}

// --- AppError normalization (no backend leak) ---
{
  const e = normalizeAppError(new FakeApiError(500, 'Internal traceback SECRET_TOKEN xyz'));
  assert(e.kind === 'server', 'server kind');
  assert(!e.message.includes('SECRET'), 'no backend leak');
  assert(!e.message.includes('traceback'), 'no traceback');
}
{
  const e = normalizeAppError(new FakeApiError(401, 'jwt expired raw'));
  assert(e.kind === 'unauthorized', '401');
}
{
  const e = normalizeAppError(new FakeApiError(403, 'forbidden detail'));
  assert(e.kind === 'forbidden', '403');
}
{
  const e = normalizeAppError(new TypeError('Failed to fetch'));
  assert(e.kind === 'network', 'network');
}
{
  const e = normalizeAppError(new Error('timeout'), { offline: true });
  assert(e.kind === 'offline', 'offline opt');
}

// 1. loading
{
  let s = idleAsyncResource<string[]>(KEY);
  s = step(s, { type: 'start', contextKey: KEY });
  assert(s.status === 'loading' && asyncIsLoading(s), '1 loading');
  assert(s.data === null, '1 no data');
}

// 2. success
{
  let s = idleAsyncResource<string[]>(KEY);
  s = step(s, { type: 'start', contextKey: KEY });
  s = step(s, { type: 'success', contextKey: KEY, data: ['a'] });
  assert(s.status === 'success' && s.data?.[0] === 'a', '2 success');
}

// 3. valid empty
{
  let s = idleAsyncResource<string[]>(KEY);
  s = step(s, { type: 'start', contextKey: KEY });
  s = step(s, { type: 'success', contextKey: KEY, data: [] });
  assert(s.status === 'empty' && asyncShowEmpty(s), '3 empty');
  assert(!asyncShowError(s), '3 not error');
}

// 4. first-load error
{
  let s = idleAsyncResource<string[]>(KEY);
  s = step(s, { type: 'start', contextKey: KEY });
  s = step(s, { type: 'failure', contextKey: KEY, error: new FakeApiError(500, 'x') });
  assert(s.status === 'error' && asyncShowError(s), '4 error');
  assert(s.data === null, '4 no fake empty data');
}

// 5. refresh error with old data → stale
{
  let s = idleAsyncResource<string[]>(KEY);
  s = step(s, { type: 'start', contextKey: KEY });
  s = step(s, { type: 'success', contextKey: KEY, data: ['keep'] });
  s = step(s, { type: 'start', contextKey: KEY, soft: true });
  assert(s.status === 'refreshing' && s.data?.[0] === 'keep', '5 refreshing keeps data');
  s = step(s, { type: 'failure', contextKey: KEY, error: new FakeApiError(503, 'down') });
  assert(s.status === 'stale' && asyncShowStale(s), '5 stale');
  assert(s.data?.[0] === 'keep', '5 data preserved');
}

// 6. retry success
{
  let s = idleAsyncResource<string[]>(KEY);
  s = step(s, { type: 'start', contextKey: KEY });
  s = step(s, { type: 'failure', contextKey: KEY, error: new Error('fail') });
  s = step(s, { type: 'start', contextKey: KEY });
  assert(s.status === 'loading' && s.data === null, '6 retry first load');
  s = step(s, { type: 'success', contextKey: KEY, data: ['ok'] });
  assert(s.status === 'success', '6 retry ok');

  // retry after stale: soft keeps data
  s = step(s, { type: 'start', contextKey: KEY, soft: true });
  s = step(s, { type: 'failure', contextKey: KEY, error: new Error('x') });
  s = step(s, { type: 'start', contextKey: KEY, soft: true });
  assert(s.data?.[0] === 'ok', '6 soft retry keeps');
  s = step(s, { type: 'success', contextKey: KEY, data: ['ok2'] });
  assert(s.status === 'success' && s.data?.[0] === 'ok2', '6 soft success');
}

// 7. offline with cache
{
  let s = idleAsyncResource<string[]>(KEY);
  s = step(s, { type: 'success', contextKey: KEY, data: ['cached'] });
  // need context match — set via start success path
  s = {
    data: ['cached'],
    status: 'success',
    error: null,
    updatedAt: 1,
    contextKey: KEY,
  };
  s = step(s, {
    type: 'failure',
    contextKey: KEY,
    error: new Error('net'),
    offline: true,
    hasCache: true,
  });
  assert(s.status === 'offline' && s.data?.[0] === 'cached', '7 offline cache');
  assert(asyncShowStale(s), '7 show stale banner');
}

// 8. offline without cache
{
  let s = idleAsyncResource<string[]>(KEY);
  s = step(s, { type: 'start', contextKey: KEY });
  s = step(s, {
    type: 'failure',
    contextKey: KEY,
    error: new Error('net'),
    offline: true,
    hasCache: false,
  });
  assert(s.status === 'offline' && s.data === null, '8 offline no cache');
  assert(asyncShowError(s), '8 treat as error UI');
}

// 9. project switch (contextKey)
{
  let s = idleAsyncResource<string[]>(KEY);
  s = step(s, { type: 'success', contextKey: KEY, data: ['old'] });
  s = step(s, { type: 'context', contextKey: KEY_B });
  assert(s.status === 'idle' && s.data === null && s.contextKey === KEY_B, '9 switch clears');
  s = step(s, { type: 'start', contextKey: KEY_B });
  assert(s.status === 'loading', '9 loading new');
}

// 10. stale response after context switch
{
  let s = idleAsyncResource<string[]>(KEY);
  s = step(s, { type: 'start', contextKey: KEY });
  s = step(s, { type: 'context', contextKey: KEY_B });
  s = step(s, { type: 'start', contextKey: KEY_B });
  // late response for KEY
  s = step(s, { type: 'success', contextKey: KEY, data: ['leaked'] });
  assert(s.data === null && s.contextKey === KEY_B, '10 ignore stale success');
  s = step(s, { type: 'failure', contextKey: KEY, error: new Error('x') });
  assert(s.status === 'loading', '10 ignore stale failure');
  s = step(s, { type: 'success', contextKey: KEY_B, data: ['new'] });
  assert(s.data?.[0] === 'new', '10 apply new');
}

// schedule null success = empty plan (not error)
{
  let s = idleAsyncResource<null | { id: string }>(KEY);
  s = step(s, { type: 'start', contextKey: KEY });
  s = step(s, { type: 'success', contextKey: KEY, data: null, empty: true });
  assert(s.status === 'empty', 'plan null = empty');
}

console.log('asyncResource.test OK');
