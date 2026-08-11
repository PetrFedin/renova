/** W140: заявка заказчика — реальный ввод + непрерывный lead → quoted → project flow */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

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

console.log('jobLeadCreate.w140.test.ts OK');
