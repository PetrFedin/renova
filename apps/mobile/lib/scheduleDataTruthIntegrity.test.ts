import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

const resource = read('apps/mobile/lib/async/asyncResource.ts');
const hook = read('apps/mobile/lib/async/useAsyncResource.ts');
const calendarApi = read('apps/mobile/lib/api/calendar.ts');
const workApi = read('apps/mobile/lib/api/workOrders.ts');
const materialsApi = read('apps/mobile/lib/api/materials.ts');
const screen = read('apps/mobile/components/screens/schedule/UnifiedScheduleView.tsx');
const notice = read('apps/mobile/components/renova/schedule/ScheduleDataStateNotice.tsx');

assert.match(resource, /status: event\.stale \? 'stale' : empty \? 'empty' : 'success'/, 'stale and empty must remain distinct');
assert.match(resource, /if \(resource\.data != null\)[\s\S]{0,120}status: 'stale'/, 'refresh failure must preserve existing data');
assert.match(resource, /if \(event\.contextKey !== resource\.contextKey\) return resource/, 'old-project result must be ignored');
assert.doesNotMatch(resource, /failure[\s\S]{0,200}status: 'empty'/, 'failure must never become empty');

assert.match(hook, /generationRef/, 'loader must reject out-of-order responses');
assert.match(hook, /abortRef\.current\?\.abort\(\)/, 'obsolete requests must be cancelled');
assert.match(hook, /controller\.signal/, 'domain fetcher must receive cancellation signal');
assert.match(hook, /reduceAsyncResource\(previous, \{ type: 'context', contextKey \}\)/, 'project switch must reset resource trust');

for (const [name, source, method] of [
  ['calendar', calendarApi, 'getCalendarFresh'],
  ['work orders', workApi, 'listWorkOrdersFresh'],
  ['purchases', materialsApi, 'listPurchasesFresh'],
] as const) {
  assert.match(source, new RegExp(method), `${name} must expose a truth-preserving read`);
  assert.match(source, /cacheFallback: false/, `${name} truth read must not hide load failure`);
}

assert.match(screen, /useAsyncResource<CalendarData>/, 'calendar must use AsyncResource');
assert.match(screen, /useAsyncResource<WorkOrder\[\]>/, 'work orders must use AsyncResource');
assert.match(screen, /useAsyncResource<Purchase\[\]>/, 'purchases must use AsyncResource');
assert.match(screen, /ScheduleDataStateNotice/, 'stale and error states must be visible');
assert.match(screen, /workOrdersData == null && asyncShowError\(workOrdersResource\)/, 'work-order error must have a non-empty UI branch');
assert.match(screen, /purchasesUnavailable/, 'incomplete supply events must be disclosed');
assert.doesNotMatch(screen, /setWorkOrders\(\[\]\)/, 'work-order failure must not erase data');
assert.doesNotMatch(screen, /setPurchases\(\[\]\)/, 'purchase failure must not erase data');
assert.doesNotMatch(screen, /setCal\(null\)/, 'calendar failure must not erase previous data');

assert.match(notice, /asyncShowError/, 'notice must render hard errors');
assert.match(notice, /asyncShowStale/, 'notice must render stale data');
assert.match(notice, /Обновить/, 'notice must provide retry');

console.log('scheduleDataTruthIntegrity.test OK');
