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
  'components/renova/CreateWorkSheet.tsx',
  'components/renova/DocumentsHub.tsx',
  'components/renova/FloorPlanPanel.tsx',
  'components/renova/JobLeadsBoard.tsx',
  'components/renova/NotificationCenter.tsx',
  'components/renova/ProjectEmptyState.tsx',
  'components/renova/ViewerSharePanel.tsx',
  'components/renova/chat/ChatThreadView.tsx',
  'components/renova/schedule/ScheduleIconToolbar.tsx',
  'components/screens/PortalScreen.tsx',
  'components/screens/RoomDetailScreen.tsx',
  'components/screens/StageDetailScreen.tsx',
  'components/screens/estimate/ContractorEstimateView.tsx',
  'components/screens/estimate/EstimateChangesLayer.tsx',
  'components/screens/estimate/EstimateDocumentsLayer.tsx',
  'components/screens/stage/StageDetailAcceptanceFold.tsx',
  'lib/context/RenovaContext.tsx',
  'lib/createProjectChat.ts',
  'lib/customerBudgetMigrate.ts',
  'lib/hooks/useCustomerBudget.ts',
];

const fabricatedPatterns = [
  /user:\s*user\s*\?\?\s*\(\{\s*id:/,
  /project:\s*activeProject\s*\?\?\s*\(\{\s*id:/,
  /\{\s*id:\s*(?:userId|projectId)\s*\}\s*as\s*(?:any|never)/,
  /user:\s*\{\s*id:[^}]+\}\s*as\s*(?:any|never)/,
  /project:\s*\{\s*id:[^}]+\}\s*as\s*(?:any|never)/,
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

const createWorkSheet = read('components/renova/CreateWorkSheet.tsx');
if (!/user\?\.id === userId && activeProject\?\.id === projectId/.test(createWorkSheet)) {
  throw new Error('work creation side effects must verify active context identity');
}
if (!/syncProjectSideEffects\(\{ user, project: activeProject \}\)/.test(createWorkSheet)) {
  throw new Error('work creation side effects must use real Renova context');
}
if (!/createWorkSheet\.sideEffects/.test(createWorkSheet) || !/createWorkSheet\.onCreated/.test(createWorkSheet)) {
  throw new Error('committed work follow-up failures must be isolated and reported');
}

const createProjectChat = read('lib/createProjectChat.ts');
if (!/const project = await api\.getProject\(user\.id, projectId\)/.test(createProjectChat)) {
  throw new Error('chat creation must load the real selected project before side effects');
}
if (!/syncProjectSideEffects\(\{ user, project \}\)/.test(createProjectChat)) {
  throw new Error('chat creation side effects must use real User + ProjectDetail context');
}
if (!/createProjectChat\.sideEffects/.test(createProjectChat) || !/createProjectChat\.projectRefresh/.test(createProjectChat)) {
  throw new Error('committed chat follow-up failures must be isolated from mutation failure');
}
if (!/failedInvites \+= 1/.test(createProjectChat) || !/createProjectChat\.invite/.test(createProjectChat)) {
  throw new Error('partial chat invitation failure must be counted and reported');
}

const chatThread = read('components/renova/chat/ChatThreadView.tsx');
if (!/const freshProject = await api\.getProject\(user\.id, projectId\)/.test(chatThread)) {
  throw new Error('chat thread post-commit reconciliation must load a fresh ProjectDetail');
}
if (!/syncProjectSideEffects\(\{ user, project: freshProject \}\)/.test(chatThread)) {
  throw new Error('chat thread global side effects must use fresh User + ProjectDetail context');
}
for (const action of ['Confirm', 'Invoice', 'Task']) {
  if (!chatThread.includes(`reconcileCommittedChatMutation('${action}')`)) {
    throw new Error(`chat ${action} mutation must reconcile only after commit`);
  }
}
if (!/Reaction\.Mutation/.test(chatThread) || !/MessagePin\.Mutation/.test(chatThread) || !/ChatPin\.Mutation/.test(chatThread)) {
  throw new Error('chat reaction and pin online failures must remain observable');
}

const documentsHub = read('components/renova/DocumentsHub.tsx');
if (/syncProjectSideEffects/.test(documentsHub)) {
  throw new Error('documents hub must reconcile committed mutations through fresh loadProject, not stale side-effect sync');
}
if (!/DocumentsHub\.ContextChangedAfterCommit/.test(documentsHub) || !/await loadProject\(projectId\)/.test(documentsHub)) {
  throw new Error('documents hub must guard active context and refresh the real ProjectDetail');
}
if (!/reconcileProjectAfterCommit\('BankImport'\)/.test(documentsHub)) {
  throw new Error('bank import must reconcile the project only after committed import');
}
if (/OCR:\s*DEMO/.test(documentsHub) || !/const ocrModeLabel = 'LOCAL'/.test(documentsHub)) {
  throw new Error('documents hub OCR mode must remain truthful for local heuristic classification');
}

const portalScreen = read('components/screens/PortalScreen.tsx');
if (!/api\.me\(currentSession\.user_id\)/.test(portalScreen) || !/api\.getProject\(currentSession\.user_id, currentSession\.project_id\)/.test(portalScreen)) {
  throw new Error('portal side effects must resolve real User + ProjectDetail before global sync');
}
if (!/syncProjectSideEffects\(\{[\s\S]*?user: realUser,[\s\S]*?project: realProject/.test(portalScreen)) {
  throw new Error('portal side effects must use resolved real API entities');
}
if (!/PortalScreen\.PostCommitRefresh/.test(portalScreen) || !/PortalScreen\.PostCommitSuccessUi/.test(portalScreen)) {
  throw new Error('portal committed mutations must isolate refresh/success-UI failures');
}

const roomDetail = read('components/screens/RoomDetailScreen.tsx');
if (!/await api\.updateRoom\([\s\S]*?await reconcileCommittedRoomMutation/.test(roomDetail)) {
  throw new Error('room mutations must reconcile only after the room PATCH commits');
}
if (!/await loadProject\(projectId\)/.test(roomDetail)) {
  throw new Error('room post-commit reconciliation must refresh a real ProjectDetail before inbox/home propagation');
}
if (/syncProjectSideEffects\(\{\s*user,\s*project:\s*activeProject\s*\}\)/.test(roomDetail)) {
  throw new Error('room mutations must not propagate stale pre-mutation activeProject');
}
if (!/archived:\s*false/.test(roomDetail) || !/archived:\s*true/.test(roomDetail) || !/Комната не найдена/.test(roomDetail)) {
  throw new Error('room detail must terminate loading for active, archived, and missing room states');
}

const stageDetail = read('components/screens/StageDetailScreen.tsx');
if (/compressUri\(await fetch/.test(stageDetail)) {
  throw new Error('stage photo compression must receive an image URI, never a Blob');
}
if (!/const compressedUri = await compressUri\(asset\.uri\)/.test(stageDetail) || !/const blob = await compressedResponse\.blob\(\)/.test(stageDetail)) {
  throw new Error('stage photo flow must compress URI before producing the upload Blob');
}
if (!/const uploadResponse = await fetch\(up\.upload_url/.test(stageDetail) || !/if \(!uploadResponse\.ok\)/.test(stageDetail)) {
  throw new Error('stage photo metadata must not be registered before a successful storage PUT');
}
if (!/await api\.addStagePhoto\([\s\S]*?up\.key, up\.public_url\)/.test(stageDetail)) {
  throw new Error('stage photo flow must register storage key/url only after upload');
}
if (/syncProjectSideEffects/.test(stageDetail)) {
  throw new Error('stage detail must reconcile committed mutations through fresh loadProject, not stale project sync');
}
if (!/PhotoProjectRefresh/.test(stageDetail) || !/CommentProjectRefresh/.test(stageDetail) || !/await loadProject\(activeProject\.id\)/.test(stageDetail)) {
  throw new Error('stage photo/comment commits must isolate fresh project reconciliation failures');
}
if (!/p\.image_url \?/.test(stageDetail)) {
  throw new Error('stage photo rendering must use the typed image_url contract');
}

const stageAcceptance = read('components/screens/stage/StageDetailAcceptanceFold.tsx');
if (/syncProjectSideEffects/.test(stageAcceptance)) {
  throw new Error('stage acceptance fold must not fabricate or propagate stale project context');
}
if (!/contextRef\.current\.userId !== userId/.test(stageAcceptance) || !/await loadProject\(projectId\)/.test(stageAcceptance)) {
  throw new Error('stage acceptance reconciliation must guard context identity and refresh the real project');
}
if (!/await api\.toggleStageChecklist\([\s\S]*?await reconcileCommittedStageChange\('ToggleChecklist'\)/.test(stageAcceptance)) {
  throw new Error('stage checklist commit must be separated from post-commit reconciliation');
}
if (!/p\.image_url \?/.test(stageAcceptance)) {
  throw new Error('acceptance photo rendering must use the typed image_url contract');
}

const contractorEstimate = read('components/screens/estimate/ContractorEstimateView.tsx');
if (!/const project = activeProject;/.test(contractorEstimate)) {
  throw new Error('contractor estimate mutations must capture the non-null selected project after the render guard');
}
if (/syncProjectSideEffects/.test(contractorEstimate)) {
  throw new Error('contractor estimate must not duplicate fresh loadProject reconciliation with stale project sync');
}
if (!/await loadProject\(project\.id\)/.test(contractorEstimate)) {
  throw new Error('contractor estimate commits must reconcile through a fresh ProjectDetail load');
}

const estimateChanges = read('components/screens/estimate/EstimateChangesLayer.tsx');
if (/syncProjectSideEffects/.test(estimateChanges)) {
  throw new Error('change-order decisions must not use fabricated or stale project side-effect context');
}
if (!/result = await api\.approveChangeOrder/.test(estimateChanges) || !/await api\.rejectChangeOrder/.test(estimateChanges)) {
  throw new Error('change-order layer must keep approve/reject mutation boundaries explicit');
}
if (!/await onProjectReload\(\)/.test(estimateChanges) || !/onOrdersChanged\(await api\.listChangeOrders/.test(estimateChanges)) {
  throw new Error('committed change-order decisions must reconcile project and order read models independently');
}
if (!/Approve\.Mutation/.test(estimateChanges) || !/Reject\.Mutation/.test(estimateChanges) || !/OrdersRefresh/.test(estimateChanges)) {
  throw new Error('change-order mutation and follow-up failures must remain separately observable');
}

const estimateDocuments = read('components/screens/estimate/EstimateDocumentsLayer.tsx');
if (!/result = await api\.importEstimateCsv\(userId, projectId, csvText\)/.test(estimateDocuments)) {
  throw new Error('estimate CSV flow must retain the committed import result');
}
if (!/await loadProject\(projectId\)/.test(estimateDocuments)) {
  throw new Error('estimate CSV post-commit reconciliation must refresh the selected ProjectDetail');
}
if (!/EstimateDocumentsLayer\.PostCommitRefresh/.test(estimateDocuments) || !/refreshFailed/.test(estimateDocuments)) {
  throw new Error('estimate CSV refresh failure must remain distinguishable from import failure');
}
if (/syncProjectSideEffects/.test(estimateDocuments)) {
  throw new Error('estimate CSV flow must not duplicate project side effects after loadProject reconciliation');
}
if (!/ContextChangedAfterCommit/.test(estimateDocuments)) {
  throw new Error('estimate CSV flow must detect project context changes after commit');
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
