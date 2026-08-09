/** Investor: code-only reliability — bare hubs, truthful calendar error, schedule dedupe, offline CTA */
import { readFileSync } from 'fs';
import { join } from 'path';
import { resolvePushLink } from './pushLinks';

const mobile = join(__dirname, '..');

const cal = resolvePushLink('/calendar', '/home', 'customer');
const repair = resolvePushLink('/repair?tab=control', '/home', 'contractor');
const budget = resolvePushLink('/budget?tab=payments', '/home', 'customer');
const object = resolvePushLink('/object?tab=plan', '/home', 'customer');

console.assert(cal?.pathname.includes('/(customer)/(tabs)/calendar'), 'bare /calendar → role tab');
console.assert(
  repair?.pathname.includes('/(contractor)/(tabs)/repair') && repair?.params?.tab === 'control',
  'bare /repair?tab=control',
);
console.assert(
  budget?.pathname.includes('/(customer)/(tabs)/budget') && budget?.params?.tab === 'payments',
  'bare /budget?tab=payments',
);
console.assert(
  object?.pathname.includes('/(customer)/(tabs)/object') && object?.params?.tab === 'plan',
  'bare /object?tab=plan',
);

const nav = readFileSync(join(mobile, 'lib/navigation.ts'), 'utf8');
const offline = readFileSync(join(mobile, 'lib/offlineUi.ts'), 'utf8');
const sched = readFileSync(join(mobile, 'components/screens/schedule/UnifiedScheduleView.tsx'), 'utf8');
const asyncResource = readFileSync(join(mobile, 'lib/async/asyncResource.ts'), 'utf8');
const planTab = readFileSync(join(mobile, 'components/screens/OsPlanTabScreen.tsx'), 'utf8');
const hub = readFileSync(join(mobile, 'components/renova/os/OsHubTabs.tsx'), 'utf8');
const status = readFileSync(join(mobile, 'components/renova/OfflineSyncStatus.tsx'), 'utf8');
const inbox = readFileSync(join(mobile, 'components/screens/UnifiedInboxScreen.tsx'), 'utf8');

console.assert(nav.includes('pushOsNav(path') || nav.includes('pushOsNav(qs'), 'pushScreen → string SoT');
console.assert(offline.includes("'/conflicts'") && offline.includes('Очередь'), 'offline → conflicts');
console.assert(
  sched.includes('asyncShowError(calendarResource)') && sched.includes('LoadErrorState'),
  'calendar error UI',
);
console.assert(
  sched.includes('useAsyncResource<CalendarData>') && asyncResource.includes("status: 'stale'"),
  'calendar truth state',
);
console.assert(!planTab.includes("label: 'График'") && planTab.includes("subParam === 'schedule'"), 'schedule subtab removed');
console.assert(hub.includes('secondary.reduce') && !hub.includes("badgeT}>·"), 'hub badge number');
console.assert(status.includes('Открыть конфликты'), 'offline status CTA');
console.assert(
  inbox.includes("!visible.length && health.status === 'complete'")
    && inbox.includes("health.status === 'degraded'")
    && inbox.includes('Не все данные входящих обновились'),
  'inbox empty state is shown only for authoritative complete data',
);
console.assert(
  inbox.includes('Пустой список не означает, что активных задач нет.')
    && inbox.includes('Повторить загрузку'),
  'degraded inbox explains uncertainty and offers retry',
);

const ok =
  Boolean(cal?.pathname.includes('calendar')) &&
  Boolean(repair?.params?.tab === 'control') &&
  offline.includes('/conflicts') &&
  sched.includes('asyncShowError(calendarResource)') &&
  sched.includes('useAsyncResource<CalendarData>') &&
  inbox.includes("!visible.length && health.status === 'complete'");

if (!ok) process.exit(1);
console.log('reliabilityUx.w152.test OK');
