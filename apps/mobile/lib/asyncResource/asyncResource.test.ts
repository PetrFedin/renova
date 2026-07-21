/**
 * Unit tests: asyncResource reducer — load / error / stale / project race.
 * Run: npx tsx apps/mobile/lib/asyncResource/asyncResource.test.ts
 */
import {
  asyncResourceReducer,
  createAsyncResource,
  formatLoadError,
  hasLoadedData,
  isEmptySuccessList,
  isInitialPending,
  startActionFor,
} from './reducer';
import type { AsyncResource } from './types';

const must = (cond: boolean, msg: string) => {
  if (!cond) throw new Error(msg);
};

function assertEq<T>(a: T, b: T, msg: string) {
  if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

// --- 1. initial loading ---
{
  let s = createAsyncResource<string[]>('p1');
  assertEq(s.status, 'idle', '1 idle');
  assertEq(s.data, undefined, '1 no data');
  const { action, requestId } = startActionFor(s, 'p1');
  s = asyncResourceReducer(s, action);
  assertEq(s.status, 'loading', '1 loading');
  assertEq(s.requestId, requestId, '1 requestId');
  must(isInitialPending(s.status), '1 initial pending');
}

// --- 2. successful load ---
{
  let s = createAsyncResource<string[]>('p1');
  s = asyncResourceReducer(s, { type: 'begin_fetch', projectId: 'p1', requestId: 1 });
  s = asyncResourceReducer(s, { type: 'success', projectId: 'p1', requestId: 1, data: ['a'] });
  assertEq(s.status, 'success', '2 success');
  must(hasLoadedData(s), '2 has data');
  assertEq(s.data![0], 'a', '2 data');
  assertEq(s.stale, false, '2 not stale');
}

// --- 3. initial request error ---
{
  let s = createAsyncResource<string[]>('p1');
  s = asyncResourceReducer(s, { type: 'begin_fetch', projectId: 'p1', requestId: 1 });
  s = asyncResourceReducer(s, { type: 'error', projectId: 'p1', requestId: 1, message: 'boom' });
  assertEq(s.status, 'error', '3 error');
  assertEq(s.data, undefined, '3 no data cleared to empty');
  assertEq(s.error, 'boom', '3 message');
  assertEq(s.stale, false, '3 not stale without prior data');
  must(!isEmptySuccessList(s), '3 not empty-success');
}

// --- 4. success → refresh error → keep data ---
{
  let s = createAsyncResource<string[]>('p1');
  s = asyncResourceReducer(s, { type: 'begin_fetch', projectId: 'p1', requestId: 1 });
  s = asyncResourceReducer(s, { type: 'success', projectId: 'p1', requestId: 1, data: ['kept'] });
  s = asyncResourceReducer(s, { type: 'begin_fetch', projectId: 'p1', requestId: 2 });
  assertEq(s.status, 'refreshing', '4 refreshing');
  assertEq(s.data![0], 'kept', '4 data during refresh');
  s = asyncResourceReducer(s, { type: 'error', projectId: 'p1', requestId: 2, message: 'refresh fail' });
  assertEq(s.status, 'error', '4 error');
  assertEq(s.data![0], 'kept', '4 data preserved');
  assertEq(s.stale, true, '4 stale');
}

// --- 5. empty successful response ---
{
  let s = createAsyncResource<string[]>('p1');
  s = asyncResourceReducer(s, { type: 'begin_fetch', projectId: 'p1', requestId: 1 });
  s = asyncResourceReducer(s, { type: 'success', projectId: 'p1', requestId: 1, data: [] });
  must(isEmptySuccessList(s), '5 empty success');
  assertEq(s.status, 'success', '5 status');
}

// --- 6. project ID change mid-flight ---
{
  let s = createAsyncResource<string[]>('p1');
  s = asyncResourceReducer(s, { type: 'begin_fetch', projectId: 'p1', requestId: 1 });
  s = asyncResourceReducer(s, { type: 'bind_project', projectId: 'p2' });
  assertEq(s.projectId, 'p2', '6 rebound');
  assertEq(s.data, undefined, '6 cleared');
  assertEq(s.status, 'idle', '6 idle after bind');
  // late response for p1 ignored
  const before = s;
  s = asyncResourceReducer(s, { type: 'success', projectId: 'p1', requestId: 1, data: ['stale'] });
  assertEq(s, before, '6 ignore foreign project success');
}

// --- 7. parallel sources independent (simulate two reducers) ---
{
  let cal = createAsyncResource<{ events: number[] }>('p1');
  let purchases = createAsyncResource<string[]>('p1');
  cal = asyncResourceReducer(cal, { type: 'begin_fetch', projectId: 'p1', requestId: 1 });
  purchases = asyncResourceReducer(purchases, { type: 'begin_fetch', projectId: 'p1', requestId: 1 });
  cal = asyncResourceReducer(cal, {
    type: 'success',
    projectId: 'p1',
    requestId: 1,
    data: { events: [1] },
  });
  purchases = asyncResourceReducer(purchases, {
    type: 'error',
    projectId: 'p1',
    requestId: 1,
    message: 'purchases down',
  });
  must(hasLoadedData(cal), '7 calendar ok');
  assertEq(purchases.status, 'error', '7 purchases error');
  assertEq(purchases.data, undefined, '7 purchases no fake empty');
}

// --- 8. stale response old project / old requestId ---
{
  let s = createAsyncResource<string[]>('p2');
  s = asyncResourceReducer(s, { type: 'begin_fetch', projectId: 'p2', requestId: 5 });
  const snap = s;
  s = asyncResourceReducer(s, { type: 'success', projectId: 'p2', requestId: 4, data: ['old-req'] });
  assertEq(s, snap, '8 ignore old requestId');
  s = asyncResourceReducer(s, { type: 'success', projectId: 'p2', requestId: 5, data: ['new'] });
  assertEq(s.data![0], 'new', '8 accept current requestId');
}

// --- formatLoadError ---
{
  assertEq(formatLoadError(new Error('x')), 'x', 'fmt error');
  assertEq(formatLoadError('y'), 'y', 'fmt string');
  must(formatLoadError(null).includes('Не удалось'), 'fmt fallback');
}

// --- null schedule success (plan not created) ---
{
  let s: AsyncResource<null | { id: string }> = createAsyncResource('p1');
  s = asyncResourceReducer(s, { type: 'begin_fetch', projectId: 'p1', requestId: 1 });
  s = asyncResourceReducer(s, { type: 'success', projectId: 'p1', requestId: 1, data: null });
  must(hasLoadedData(s), 'null success is loaded');
  assertEq(s.data, null, 'null means no plan');
  assertEq(s.status, 'success', 'null success status');
}

// --- source guards: screens must not setItems([]) in catch ---
{
  const { readFileSync } = require('fs') as typeof import('fs');
  const { join } = require('path') as typeof import('path');
  const root = join(__dirname, '../..');
  const sel = readFileSync(join(root, 'components/screens/OsSelectionsScreen.tsx'), 'utf8');
  must(!sel.includes('setItems([])'), 'selections: no setItems([])');
  must(sel.includes('useAsyncResource'), 'selections uses useAsyncResource');
  const sched = readFileSync(join(root, 'components/screens/schedule/UnifiedScheduleView.tsx'), 'utf8');
  must(!sched.includes('setPurchases([])'), 'schedule: no setPurchases([])');
  must(!sched.includes('setWorkOrders([])'), 'schedule: no setWorkOrders([])');
  must(sched.includes('План ещё не создан'), 'schedule keeps empty-plan copy');
  must(sched.includes('hasLoadedData(scheduleRes)'), 'schedule gates empty-plan on success');
  const reports = readFileSync(join(root, 'app/_stack/reports.tsx'), 'utf8');
  must(!reports.includes('setDaily(null)'), 'reports: no null wipe on error');
  must(reports.includes('reloadDaily'), 'reports per-source retry');
}

console.log('asyncResource.test OK');
