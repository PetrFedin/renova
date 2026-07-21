/** W114: widget role SoT; waste/WO offline UX; stage depends & chat task offline */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const strip = readFileSync(join(mobile, 'components/renova/os/OsWidgetStrip.tsx'), 'utf8');
const budget = readFileSync(join(mobile, 'components/screens/budget/BudgetSummarySection.tsx'), 'utf8');
const sites = readFileSync(join(mobile, 'components/renova/ProjectSitesPanel.tsx'), 'utf8');
const waste = readFileSync(join(mobile, 'components/renova/WasteOrderList.tsx'), 'utf8');
const wo = readFileSync(join(mobile, 'components/renova/WorkOrderDetailPanel.tsx'), 'utf8');
const est = readFileSync(join(mobile, 'components/renova/StageEstimatePanel.tsx'), 'utf8');
const stages = readFileSync(join(mobile, 'lib/api/stages.ts'), 'utf8');
const chats = readFileSync(join(mobile, 'lib/api/chats.ts'), 'utf8');
const chatUi = readFileSync(join(mobile, 'components/renova/chat/ChatThreadView.tsx'), 'utf8');

console.assert(strip.includes('role?: OsRole') && strip.includes('pushOsNav(it.href!, undefined, role)'), 'widget role SoT');
console.assert(budget.includes('returnTo={pathname} role={role}'), 'budget summary role');
console.assert(sites.includes('returnTo={returnTo} role={role}'), 'sites panel role');
console.assert(waste.includes('offline_queued') || waste.includes('isOfflineQueued'), 'waste UI offline');
console.assert(waste.includes('notifyOfflineQueued'), 'waste notify');
console.assert(wo.includes("pushOsNav('/approvals'") && wo.includes('role)'), 'WO approvals role');
console.assert(wo.includes('isOfflineQueued') && wo.includes('notifyOfflineQueued'), 'WO notes offline');
console.assert(est.includes('pushOsNav(estimateHref, returnTo, role)'), 'estimate panel role');
console.assert(stages.includes('patchStageDepends') && stages.includes('offline_queued'), 'depends offline');
console.assert(stages.includes('patchStageWorkType') && stages.includes('offline_queued'), 'workType offline');
console.assert(chats.includes('taskFromChatMessage') && chats.includes('offline_queued'), 'chat task offline');
console.assert(chats.includes('confirmChatMessage') && chats.includes('offline_queued'), 'chat confirm offline');
console.assert(chats.includes('markChatRead') && chats.includes('offline_queued'), 'chat read offline');
console.assert(chatUi.includes('Задача из чата') && chatUi.includes('notifyOfflineQueued'), 'chat task UI');
console.assert(chatUi.includes('Подтверждение') && chatUi.includes('isOfflineQueued'), 'chat confirm UI');

console.log('journeyUnify.w114.test.ts OK');
