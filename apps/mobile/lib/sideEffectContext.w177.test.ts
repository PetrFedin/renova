/** W177: post-mutation side effects must use real domain objects, never fabricated ids. */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobileRoot = join(__dirname, '..');

function read(relativePath: string): string {
  return readFileSync(join(mobileRoot, relativePath), 'utf8');
}

const contextFiles = [
  'components/renova/ContractorDirectory.tsx',
  'components/renova/CreatePaymentForm.tsx',
  'components/renova/FloorPlanPanel.tsx',
  'components/renova/JobLeadsBoard.tsx',
  'components/renova/NotificationCenter.tsx',
  'components/renova/ProjectEmptyState.tsx',
  'components/renova/ViewerSharePanel.tsx',
  'components/renova/schedule/ScheduleIconToolbar.tsx',
  'lib/context/RenovaContext.tsx',
  'lib/customerBudgetMigrate.ts',
  'lib/hooks/useCustomerBudget.ts',
];

const fabricatedPatterns = [
  /user:\s*user\s*\?\?\s*\(\{\s*id:/,
  /project:\s*activeProject\s*\?\?\s*\(\{\s*id:/,
  /\{\s*id:\s*(?:userId|projectId)\s*\}\s*as\s*(?:any|never)/,
  /project:\s*\w+\s+as\s+any/,
];

for (const relativePath of contextFiles) {
  const source = read(relativePath);
  for (const pattern of fabricatedPatterns) {
    if (pattern.test(source)) {
      throw new Error(`${relativePath}: fabricated side-effect context matched ${pattern}`);
    }
  }
}

const projectsApi = read('lib/api/projects.ts');
if (!/createProjectFromTemplate:[\s\S]*?req<ProjectDetail>\(/.test(projectsApi)) {
  throw new Error('project template mutation must return ProjectDetail');
}

const miscApi = read('lib/api/misc.ts');
if (!/linkContractor:[\s\S]*?req<ProjectDetail>\(/.test(miscApi)) {
  throw new Error('contractor link mutation must return ProjectDetail');
}

const contractorDirectory = read('components/renova/ContractorDirectory.tsx');
if (!/const linkedProject = await api\.linkContractor/.test(contractorDirectory)) {
  throw new Error('contractor link flow must retain the committed ProjectDetail response');
}
if (!/syncProjectSideEffects\(\{ user, project: linkedProject \}\)/.test(contractorDirectory)) {
  throw new Error('contractor link side effects must use the committed ProjectDetail response');
}

const projectEmptyState = read('components/renova/ProjectEmptyState.tsx');
if (!/const project = await api\.createProjectFromTemplate/.test(projectEmptyState)) {
  throw new Error('template creation flow must retain its ProjectDetail response');
}
if (!/loadProject\(project\.id\)/.test(projectEmptyState)) {
  throw new Error('template creation flow must load the typed project id');
}
if (!/syncProjectSideEffects\(\{ user, project \}\)/.test(projectEmptyState)) {
  throw new Error('template creation side effects must use the typed ProjectDetail response');
}

const viewerSharePanel = read('components/renova/ViewerSharePanel.tsx');
if (!/syncProjectSideEffects\(\{ user, project: activeProject \}\)/.test(viewerSharePanel)) {
  throw new Error('viewer access side effects must use real Renova context');
}
if (/listViewers\([\s\S]*?\.catch\([\s\S]*?setItems\(\[\]\)/.test(viewerSharePanel)) {
  throw new Error('viewer load failure must not be rendered as a false empty guest list');
}
if (!/setItemsLoadFailed\(true\)/.test(viewerSharePanel) || !/Повторить загрузку гостевого доступа/.test(viewerSharePanel)) {
  throw new Error('viewer load failure must expose an explicit retryable error state');
}

const scheduleIconToolbar = read('components/renova/schedule/ScheduleIconToolbar.tsx');
if (!/user\?\.id === userId && activeProject\?\.id === projectId/.test(scheduleIconToolbar)) {
  throw new Error('calendar import side effects must verify active context identity');
}
if (!/syncProjectSideEffects\(\{ user, project: activeProject \}\)/.test(scheduleIconToolbar)) {
  throw new Error('calendar import side effects must use real Renova context');
}
if (!/importIcal\.sideEffects/.test(scheduleIconToolbar)) {
  throw new Error('calendar import follow-up failure must be reported separately from committed import failure');
}

const budgetMigration = read('lib/customerBudgetMigrate.ts');
if (!/syncCustomerBudgetOnLoad\(\s*user: User,\s*project: ProjectDetail/.test(budgetMigration)) {
  throw new Error('customer budget migration must receive real user and project domain objects');
}
if (!/syncProjectSideEffects\(\{ user, project: committed \}\)/.test(budgetMigration)) {
  throw new Error('customer budget migration side effects must use committed ProjectDetail');
}
if (!/return committed;/.test(budgetMigration) || !/return project;/.test(budgetMigration)) {
  throw new Error('customer budget migration must distinguish committed server truth from local fallback');
}

const budgetHook = read('lib/hooks/useCustomerBudget.ts');
if (!/syncProjectSideEffects\(\{ user, project: committed \}\)/.test(budgetHook)) {
  throw new Error('customer budget save side effects must use committed ProjectDetail');
}
if (!/setSyncState\('local_only'\)/.test(budgetHook)) {
  throw new Error('customer budget remote failure must remain visibly distinguishable as local-only state');
}

const renovaContext = read('lib/context/RenovaContext.tsx');
if (!/projectProfile\.sideEffects/.test(renovaContext) || !/projectProfile\.refreshProjects/.test(renovaContext)) {
  throw new Error('project profile post-commit follow-ups must be isolated and reported');
}
if (!/p = await syncCustomerBudgetOnLoad\(user, p\)/.test(renovaContext)) {
  throw new Error('project load must preserve server-confirmed customer budget truth');
}

console.log('sideEffectContext.w177.test OK');
