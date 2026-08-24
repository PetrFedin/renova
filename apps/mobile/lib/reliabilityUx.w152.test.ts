/** Investor: code-only reliability — bare hubs, truthful calendar/report errors, schedule dedupe, offline CTA */
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
const offlineQueue = readFileSync(join(mobile, 'lib/offlineQueue.ts'), 'utf8');
const sched = readFileSync(join(mobile, 'components/screens/schedule/UnifiedScheduleView.tsx'), 'utf8');
const asyncResource = readFileSync(join(mobile, 'lib/async/asyncResource.ts'), 'utf8');
const planTab = readFileSync(join(mobile, 'components/screens/OsPlanTabScreen.tsx'), 'utf8');
const hub = readFileSync(join(mobile, 'components/renova/os/OsHubTabs.tsx'), 'utf8');
const status = readFileSync(join(mobile, 'components/renova/OfflineSyncStatus.tsx'), 'utf8');
const inbox = readFileSync(join(mobile, 'components/screens/UnifiedInboxScreen.tsx'), 'utf8');
const inboxSync = readFileSync(join(mobile, 'lib/inboxSyncStore.ts'), 'utf8');
const chatHooks = readFileSync(join(mobile, 'lib/useChatUnread.ts'), 'utf8');
const chatList = readFileSync(join(mobile, 'components/renova/chat/ChatListView.tsx'), 'utf8');
const rooms = readFileSync(join(mobile, 'components/screens/OsRoomsScreen.tsx'), 'utf8');
const projectEmpty = readFileSync(join(mobile, 'components/renova/ProjectEmptyState.tsx'), 'utf8');
const home = readFileSync(join(mobile, 'components/screens/OsHomeScreen.tsx'), 'utf8');
const projectDataBus = readFileSync(join(mobile, 'lib/projectDataBus.ts'), 'utf8');
const reports = readFileSync(join(mobile, 'app/_stack/reports.tsx'), 'utf8');

console.assert(nav.includes('pushOsNav(path') || nav.includes('pushOsNav(qs'), 'pushScreen → string SoT');
console.assert(offline.includes("'/conflicts'") && offline.includes('Очередь'), 'offline → conflicts');
console.assert(
  offlineQueue.includes("reportError('offline.queueChanged.notify'")
    && offlineQueue.includes("reportError('offline.flush.responseBody'"),
  'offline queue notification and response-body failures are observable',
);
console.assert(
  offlineQueue.includes('const errorText = response.ok')
    && offlineQueue.includes("const message = errorText || (response.ok ? 'ok' : `HTTP ${response.status}`)"),
  'failed response-body reads retain HTTP status truth for retry/block decisions',
);
console.assert(
  offlineQueue.indexOf('await setQueueUnlocked(queue);') < offlineQueue.indexOf('await emitQueueChanged();'),
  'offline mutation is durable before best-effort UI notification',
);
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
console.assert(
  inboxSync.includes('threadsOk: false, unreadOk: true')
    && inboxSync.includes('chatFailed = !chatState.threadsOk')
    && inboxSync.includes('chatState.unreadOk'),
  'chat unread fallback does not pretend the thread list is fresh',
);
console.assert(
  chatHooks.includes("throw new Error('chat_inbox_refresh_degraded')")
    && chatList.includes('!displayThreads.length && loadError')
    && chatList.includes('Не удалось загрузить чаты'),
  'stale/unknown chat list reaches explicit error UI instead of fake empty',
);
console.assert(
  rooms.includes("roomsState.status === 'loaded' && !filtered.length")
    && rooms.includes("roomsState.status === 'error'")
    && rooms.includes('Пустой экран не означает, что комнат нет.'),
  'rooms empty state requires an authoritative loaded response',
);
console.assert(
  rooms.includes('Promise.allSettled')
    && rooms.includes("reportError('rooms.customer.listRooms'")
    && rooms.includes("reportError('rooms.customer.listRoomChangeRequests'")
    && rooms.includes("requestsState.status === 'error'"),
  'rooms and room-change requests expose source failure instead of silent empty fallback',
);
console.assert(
  rooms.indexOf("await api.createRoomChangeRequest") < rooms.indexOf("alertRoomChangeRequested('customer')")
    && rooms.indexOf("alertRoomChangeRequested('customer')") < rooms.indexOf('await reloadRooms();'),
  'room-change mutation is acknowledged before its non-authoritative list refresh',
);

console.assert(
  !projectEmpty.includes('Загрузить демо')
    && !projectEmpty.includes('(W69)')
    && projectEmpty.includes('Быстро начать с шаблона')
    && projectEmpty.includes('Обновить проекты'),
  'project empty state must expose production recovery instead of demo/internal CTAs',
);
console.assert(
  projectEmpty.includes("reportError('projectEmptyState.pendingPayments'")
    && !projectEmpty.includes('return [p.id, 0] as const;'),
  'failed pending-payment reads must stay unknown instead of fabricating a completed project',
);
console.assert(
  projectEmpty.includes("reportError('projectEmptyState.templateCreate'")
    && projectEmpty.includes("reportError('projectEmptyState.templateRefreshProjects'")
    && projectEmpty.includes("reportError('projectEmptyState.templateLoadProject'")
    && projectEmpty.includes("reportError('projectEmptyState.templateSideEffects'"),
  'template creation and each post-commit reconciliation phase must remain observable',
);
const templateCreateIndex = projectEmpty.indexOf('project = await api.createProjectFromTemplate');
const templateRefreshIndex = projectEmpty.indexOf('await refreshProjects();', templateCreateIndex);
const templateLoadIndex = projectEmpty.indexOf('await loadProject(project.id);', templateCreateIndex);
const templateWarningIndex = projectEmpty.indexOf('Объект создан, но не удалось открыть его автоматически');
console.assert(
  templateCreateIndex >= 0
    && templateRefreshIndex > templateCreateIndex
    && templateLoadIndex > templateCreateIndex
    && templateWarningIndex > templateLoadIndex,
  'template create commit must be separated from refresh/load reconciliation and truthful partial-success UX',
);
console.assert(
  projectEmpty.includes("showCreate && bucket === 'active' && role === 'customer'")
    && projectEmpty.includes('title="Найти заявки"')
    && projectEmpty.includes("pushOsNav('/job-leads', pathname, 'contractor')"),
  'contractor no-project state must route to marketplace leads instead of manual project creation',
);

console.assert(
  home.includes("reportError('home.dashboard'")
    && home.includes("reportError('home.pendingPayments'")
    && home.includes("reportError('home.weeklyDigest'")
    && home.includes("reportError('home.source.load'"),
  'home source failures must remain observable instead of becoming fake healthy zeros',
);
console.assert(
  home.includes('const sameProject = loadedProjectIdRef.current === projectId')
    && home.includes('if (!sameProject && isCurrentLoad())')
    && home.includes('resetProjectSnapshot();')
    && !home.includes('const fallbacks = ['),
  'home refresh preserves same-project confirmed values and clears snapshots only when project context changes',
);
console.assert(
  home.includes('const generation = ++loadGenerationRef.current')
    && home.includes('const isCurrentLoad = () => loadGenerationRef.current === generation')
    && home.includes('if (!isCurrentLoad()) return;')
    && home.includes('loadedProjectIdRef.current !== activeProject.id'),
  'stale home requests must not overwrite a newer project or finish its loading state',
);
console.assert(
  home.includes('title="Главная обновлена частично"')
    && home.includes('последние подтверждённые значения')
    && home.includes('нули и пустые блоки могут быть неполными'),
  'degraded home data must be visible to the user instead of looking authoritative',
);

console.assert(
  reports.includes('useAsyncResource<DailyReport>')
    && reports.includes('useAsyncResource<WeeklyReport>')
    && reports.includes('useAsyncResource<FinalReport>')
    && reports.includes('reports-daily:')
    && reports.includes('reports-weekly:')
    && reports.includes('reports-final:'),
  'reports keep daily/weekly/final truth in independent context-bound resources',
);
console.assert(
  reports.includes('asyncShowError(dailyResource)')
    && reports.includes('asyncShowError(weeklyResource)')
    && reports.includes('asyncShowError(finalResource)')
    && reports.includes('Не удалось загрузить дневной отчёт')
    && reports.includes('Не удалось загрузить недельный отчёт')
    && reports.includes('Не удалось загрузить финальный отчёт'),
  'initial report failures reach explicit retryable error UI instead of fake loading',
);
console.assert(
  reports.includes('asyncShowStale(dailyResource)')
    && reports.includes('asyncShowStale(weeklyResource)')
    && reports.includes('asyncShowStale(finalResource)')
    && reports.includes('последние подтверждённые данные')
    && reports.includes('последняя подтверждённая версия')
    && reports.includes('reloadDaily({ soft: true })')
    && reports.includes('reloadWeekly({ soft: true })')
    && reports.includes('reloadFinal({ soft: true })'),
  'report refresh failure preserves last confirmed data, marks it stale and offers retry',
);
console.assert(
  !reports.includes('setDaily(null)')
    && !reports.includes('setWeekly(null)')
    && !reports.includes('setFinalReport(null)')
    && !reports.includes(') : <Text style={s.meta}>Загрузка…</Text>'),
  'report failure must never be represented as indefinite loading or fabricated empty data',
);

console.assert(
  projectDataBus.includes("reportError('projectDataBus.listener'")
    && projectDataBus.includes("reportError('projectDataBus.inboxImport'")
    && projectDataBus.includes("reportCatch('projectDataBus.inboxSync')"),
  'project data propagation failures must be observable at listener, import, and inbox-refresh boundaries',
);
const inboxImportFailureIndex = projectDataBus.indexOf("reportError('projectDataBus.inboxImport'");
const notifyAfterImportFailureIndex = projectDataBus.indexOf('notifyProjectDataChanged();', inboxImportFailureIndex);
console.assert(
  inboxImportFailureIndex >= 0
    && notifyAfterImportFailureIndex > inboxImportFailureIndex
    && !projectDataBus.includes('/* offline / test env без inboxSyncStore */'),
  'inbox propagation degradation must not suppress home listeners or remain an anonymous fallback',
);

const ok =
  Boolean(cal?.pathname.includes('calendar')) &&
  Boolean(repair?.params?.tab === 'control') &&
  offline.includes('/conflicts') &&
  offlineQueue.includes("reportError('offline.queueChanged.notify'") &&
  offlineQueue.includes("reportError('offline.flush.responseBody'") &&
  sched.includes('asyncShowError(calendarResource)') &&
  sched.includes('useAsyncResource<CalendarData>') &&
  inbox.includes("!visible.length && health.status === 'complete'") &&
  inboxSync.includes('threadsOk: false, unreadOk: true') &&
  chatHooks.includes("throw new Error('chat_inbox_refresh_degraded')") &&
  chatList.includes('!displayThreads.length && loadError') &&
  rooms.includes("roomsState.status === 'loaded' && !filtered.length") &&
  rooms.includes("reportError('rooms.customer.listRooms'") &&
  !projectEmpty.includes('Загрузить демо') &&
  projectEmpty.includes("reportError('projectEmptyState.templateCreate'") &&
  projectEmpty.includes('title="Обновить проекты"') &&
  home.includes("reportError('home.source.load'") &&
  home.includes('const generation = ++loadGenerationRef.current') &&
  home.includes('title="Главная обновлена частично"') &&
  reports.includes('asyncShowError(dailyResource)') &&
  reports.includes('asyncShowStale(weeklyResource)') &&
  reports.includes('useAsyncResource<FinalReport>') &&
  projectDataBus.includes("reportError('projectDataBus.listener'") &&
  projectDataBus.includes("reportError('projectDataBus.inboxImport'");

if (!ok) process.exit(1);
console.log('reliabilityUx.w152.test OK');
