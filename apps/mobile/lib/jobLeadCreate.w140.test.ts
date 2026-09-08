/** W140: заявка заказчика и восстановление мастера после подтверждённой конвертации. */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { loadQuotedLead, openConvertedProject } from './leadConversionRecovery';

const mobile = join(__dirname, '..');
const repo = join(__dirname, '../../..');
const board = readFileSync(join(mobile, 'components/renova/JobLeadsBoard.tsx'), 'utf8');
const sheetPath = join(mobile, 'components/renova/CreateJobLeadSheet.tsx');
const market = readFileSync(join(mobile, 'lib/api/market.ts'), 'utf8');
const leadNav = readFileSync(join(mobile, 'lib/jobLeadNav.ts'), 'utf8');
const leadIn = readFileSync(join(repo, 'backend/app/api/v1/marketplace.py'), 'utf8');

function must(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

must(existsSync(sheetPath), 'CreateJobLeadSheet missing');
const sheet = readFileSync(sheetPath, 'utf8');

must(board.includes('CreateJobLeadSheet'), 'board opens CreateJobLeadSheet');
must(board.includes('setCreateOpen(true)'), 'button opens form');
must(board.includes('alertJobLeadCreated'), 'success alert');
must(board.includes('l.description'), 'list shows description');
must(!board.includes("title: 'Ремонт квартиры'"), 'no hardcoded title');
must(!board.includes('area_sqm: 55'), 'no hardcoded 55 m²');
must(!board.includes('budget_hint: 800000'), 'no hardcoded 800k');
must(sheet.includes('Новая заявка') && sheet.includes('area_sqm'), 'sheet collects area');
must(sheet.includes('budget_hint') && sheet.includes('renovation_type'), 'sheet collects budget+type');
must(sheet.includes('if (busy) return'), 'double-submit guard');
must(sheet.includes('Отмена') && sheet.includes('requestClose'), 'cancel while idle');
must(sheet.includes('canSubmit'), 'submit gated');
must(market.includes('export type JobLeadCreateBody'), 'shared API body type');
must(leadIn.includes('min_length=1') && leadIn.includes('Field(gt=0'), 'backend LeadIn required fields');
must(leadIn.includes('budget_hint: float = Field(gt=0'), 'backend budget required');

must(
  board.includes("api.listJobLeads(userId, 'quoted')") && board.includes("api.listJobLeads(userId, 'open')"),
  'board must fetch both quoted and open leads so accepted quotes do not disappear before conversion',
);
must(
  board.includes('loadedOnce && !loadError && items.length === 0')
    && board.includes('Пустой список не означает, что заявок нет.')
    && board.includes('title="Повторить загрузку"'),
  'lead empty state must require an authoritative load and failed loads must expose retry',
);
must(
  board.includes("reportError('jobLeads.load'") && board.includes('Показаны последние подтверждённые данные.'),
  'lead refresh failures must be observable and preserve last confirmed rows',
);

const createMutation = board.indexOf('await api.createJobLead(userId, body);');
const createAck = board.indexOf('alertJobLeadCreated(osRole);', createMutation);
const createReconcile = board.indexOf("void reconcileAfterCommit('create');", createAck);
must(
  createMutation >= 0 && createAck > createMutation && createReconcile > createAck,
  'lead creation must acknowledge committed mutation before non-authoritative reconciliation',
);
must(
  board.includes("reportError('jobLeads.create.mutation'")
    && board.includes("reportError('jobLeads.postCommit.sync'"),
  'create mutation failure and post-commit reconciliation failure must remain distinct',
);

const acceptMutation = board.indexOf('await api.acceptJobLeadQuote(userId, l.id, q.id);');
const acceptAck = board.indexOf('alertJobLeadAssigned(osRole);', acceptMutation);
const acceptReconcile = board.indexOf("void reconcileAfterCommit('accept_quote');", acceptAck);
must(
  acceptMutation >= 0 && acceptAck > acceptMutation && acceptReconcile > acceptAck,
  'accepted quote must become acknowledged quoted state before refresh/sync',
);

const autoAssignMutation = board.indexOf('await api.autoAssignLead(userId, l.id);');
const autoAssignAck = board.indexOf('alertJobLeadAssigned(osRole);', autoAssignMutation);
const autoAssignReconcile = board.indexOf("void reconcileAfterCommit('auto_assign');", autoAssignAck);
must(
  autoAssignMutation >= 0 && autoAssignAck > autoAssignMutation && autoAssignReconcile > autoAssignAck,
  'auto-assignment must acknowledge committed assignment before reconciliation',
);

const quoteMutation = board.indexOf('await api.quoteJobLead(userId, l.id, amount);');
const quoteAck = board.indexOf('alertJobLeadQuoted(osRole);', quoteMutation);
const quoteReconcile = board.indexOf("void reconcileAfterCommit('quote');", quoteAck);
must(
  quoteMutation >= 0 && quoteAck > quoteMutation && quoteReconcile > quoteAck,
  'contractor quote must acknowledge committed quote before reconciliation',
);
must(
  board.includes('parseQuoteAmount') && board.includes("message: 'Укажите сумму больше нуля.'"),
  'contractor quote must validate positive amount client-side instead of sending an invalid mutation',
);

const convertMutation = board.indexOf('converted = await api.convertJobLead(userId, l.id);');
const convertedReload = board.indexOf('void load();', convertMutation);
const convertedRefresh = board.indexOf('await refreshProjects();', convertMutation);
const convertedLoadProject = board.indexOf('await loadProject(converted.project_id);', convertMutation);
const convertedNavigate = board.indexOf("replaceOsNav('/(customer)/(tabs)/'", convertedLoadProject);
must(
  convertMutation >= 0
    && convertedReload > convertMutation
    && convertedRefresh > convertMutation
    && convertedLoadProject > convertMutation
    && convertedNavigate > convertedLoadProject,
  'quoted lead conversion must reconcile project list, open the created project and continue to customer home',
);
must(!board.includes('await sync();'), 'converted project must not sync a stale activeProject closure');
must(
  board.includes("reportError('jobLeads.convert.refreshProjects'")
    && board.includes("reportError('jobLeads.convert.loadProject'")
    && board.includes('Заявка преобразована в проект, но открыть его автоматически не удалось.'),
  'post-convert failures must report partial success instead of encouraging duplicate conversion',
);
must(
  leadNav.includes("title: 'Исполнитель закреплён'")
    && leadNav.includes('Заявка готова к преобразованию в проект.')
    && leadNav.includes('«→ Проект»'),
  'assignment confirmation must point to the actual next golden-path action',
);

const wizard = readFileSync(join(mobile, 'app/contractor-wizard/[leadId].tsx'), 'utf8');
must(wizard.includes('loadQuotedLead((status) => api.listJobLeads(userId, status), leadId)'),
  'wizard must explicitly load the quoted lead supplied by the board');
must(wizard.includes("loadState === 'error'") && wizard.includes("loadState === 'unavailable'")
  && wizard.includes('title="Повторить загрузку"'), 'wizard must terminate missing/failed loading with recovery');
must(wizard.includes('busyRef.current') && wizard.includes('loading={busy} disabled={busy}'),
  'wizard must synchronously reject duplicate clicks and disable the pending action');
must(!wizard.includes('syncProjectSideEffects') && !wizard.includes('as any'),
  'wizard must use fresh loadProject propagation, never fabricated domain context');
const wizardMutation = wizard.indexOf('converted = await api.convertJobLead(');
const wizardCommitted = wizard.indexOf('committedProjectRef.current = converted;', wizardMutation);
const wizardOpen = wizard.indexOf('await openConvertedProject(converted.project_id,', wizardCommitted);
must(wizardMutation >= 0 && wizardCommitted > wizardMutation && wizardOpen > wizardCommitted,
  'persist the acknowledged project before fallible post-commit operations');
must(wizard.includes('let converted = committedProjectRef.current;') && wizard.includes('if (!converted)')
  && wizard.includes('title="Открыть созданный проект"'), 'recovery must open the saved project, not repeat conversion');
must((wizard.match(/await api\.convertJobLead\(/g) ?? []).length === 1,
  'wizard must have only one guarded conversion call site');
must(wizard.includes('if (stateScope !== scopeKey)') && wizard.includes('setRooms(initialRooms());')
  && wizard.includes('scopeRef.current === scopeKey') && wizard.includes('loadRequest.current === request'),
  'account/lead changes must clear drafts, hide old identity-bearing state and ignore stale responses');
const selectionGuard = wizard.indexOf('activeProject?.id !== createdProject.project_id) return;');
const guardedNavigation = wizard.indexOf("replaceOsNav(tabsRoute('contractor', 'index')", selectionGuard);
must(selectionGuard >= 0 && guardedNavigation > selectionGuard && wizard.includes('Открытие объекта не подтверждено.'),
  'a swallowed rate-limit or resolved load promise must not navigate before selected-project identity matches');
must(wizard.includes('<Card ') && !/#[0-9a-f]{3,8}\b/i.test(wizard),
  'wizard must use the shared card and theme tokens rather than local color literals');

async function verifyWizardRecovery(): Promise<void> {
  const states: string[] = [];
  const target = { id: 'target', status: 'quoted', title: 'Accepted quote' };
  const found = await loadQuotedLead(async (status) => {
    states.push(status);
    return [{ id: 'other', status: 'quoted', title: 'Sibling' }, target];
  }, 'target');
  must(states.join(',') === 'quoted' && found === target, 'loader must query quoted and select the exact lead');
  must(await loadQuotedLead(async () => [{ id: 'target', status: 'open' }], 'target') === null,
    'an open lead cannot masquerade as the quoted target');
  must(await loadQuotedLead(async () => [], 'target') === null, 'authoritative absence must return null');
  const networkFailure = new Error('network unavailable');
  let observedError: unknown;
  try {
    await loadQuotedLead(async () => { throw networkFailure; }, 'target');
  } catch (error) { observedError = error; }
  must(observedError === networkFailure, 'failed loading must propagate, not become false absence');

  const calls: string[] = [];
  const opened = await openConvertedProject('saved-project', {
    refreshProjects: async () => { calls.push('refresh'); },
    loadProject: async (id) => { calls.push(`load:${id}`); },
  });
  must(opened.kind === 'load_completed' && !opened.refreshFailed && calls.join(',') === 'refresh,load:saved-project',
    'post-commit operations must request the confirmed project in order without inventing selection proof');

  calls.length = 0;
  const refreshFailure = new Error('list refresh failed');
  const refreshFailed = await openConvertedProject('saved-project', {
    refreshProjects: async () => { calls.push('refresh'); throw refreshFailure; },
    loadProject: async (id) => { calls.push(`load:${id}`); },
  });
  must(refreshFailed.kind === 'load_completed' && refreshFailed.refreshFailed
    && refreshFailed.refreshError === refreshFailure && calls.join(',') === 'refresh,load:saved-project',
    'a failed project list refresh must not prevent loading the already-created project');

  calls.length = 0;
  let attempts = 0;
  const openFailure = new Error('project fetch failed');
  const ports = {
    refreshProjects: async () => { calls.push('refresh'); },
    loadProject: async (id: string) => {
      calls.push(`load:${id}`);
      attempts += 1;
      if (attempts === 1) throw openFailure;
    },
  };
  const failed = await openConvertedProject('saved-project', ports);
  must(failed.kind === 'open_failed' && failed.openError === openFailure, 'open failure must remain a distinct recoverable result');
  const retried = await openConvertedProject('saved-project', ports);
  must(retried.kind === 'load_completed' && calls.join(',') === 'refresh,load:saved-project,refresh,load:saved-project',
    'recovery must repeat loading of the same saved identity, not conversion');

  calls.length = 0;
  const cancelled = await openConvertedProject('saved-project', {
    refreshProjects: async () => { calls.push('refresh'); },
    loadProject: async (id) => { calls.push(id); },
    isCurrent: () => false,
  });
  must(cancelled.kind === 'cancelled' && calls.length === 0, 'inactive context must not start follow-up operations');

  let current = true;
  const cancelledAfterRefresh = await openConvertedProject('saved-project', {
    refreshProjects: async () => { current = false; },
    loadProject: async () => { throw new Error('must not load after context change'); },
    isCurrent: () => current,
  });
  must(cancelledAfterRefresh.kind === 'cancelled', 'context change during refresh must stop project loading');

  current = true;
  const cancelledAfterOpen = await openConvertedProject('saved-project', {
    refreshProjects: async () => undefined,
    loadProject: async () => { current = false; },
    isCurrent: () => current,
  });
  must(cancelledAfterOpen.kind === 'cancelled', 'context change during project load must not report usable completion');

  const undefinedFailure = await openConvertedProject('saved-project', {
    refreshProjects: () => Promise.reject(undefined),
    loadProject: async () => undefined,
  });
  must(undefinedFailure.kind === 'load_completed' && undefinedFailure.refreshFailed,
    'even an undefined rejection reason must retain the refresh-failure flag');
}

void verifyWizardRecovery().then(() => {
  console.log('jobLeadCreate.w140.test.ts OK (board contracts + wizard recovery behavior)');
}).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
