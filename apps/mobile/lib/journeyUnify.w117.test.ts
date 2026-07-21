/** W117: budget/room/stage expense SoT; docs closeout; QC/floor punch; manager/home */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const alerts = readFileSync(join(mobile, 'components/renova/BudgetAlerts.tsx'), 'utf8');
const byStage = readFileSync(join(mobile, 'components/renova/ExpenseByStage.tsx'), 'utf8');
const byRoom = readFileSync(join(mobile, 'components/renova/ExpenseByRoom.tsx'), 'utf8');
const detail = readFileSync(join(mobile, 'components/renova/ExpenseDetailSheet.tsx'), 'utf8');
const docs = readFileSync(join(mobile, 'components/renova/DocumentsHub.tsx'), 'utf8');
const qc = readFileSync(join(mobile, 'components/screens/QualityControlScreen.tsx'), 'utf8');
const floor = readFileSync(join(mobile, 'components/renova/FloorPlanPanel.tsx'), 'utf8');
const mgr = readFileSync(join(mobile, 'components/screens/ManagerDashboardScreen.tsx'), 'utf8');
const hero = readFileSync(join(mobile, 'components/renova/os/HomeActionHero.tsx'), 'utf8');
const wo = readFileSync(join(mobile, 'components/renova/WorkOrderDetailPanel.tsx'), 'utf8');
const empty = readFileSync(join(mobile, 'components/renova/ProjectEmptyState.tsx'), 'utf8');
const budget = readFileSync(join(mobile, 'components/screens/budget/BudgetSummarySection.tsx'), 'utf8');

console.assert(alerts.includes("pathname: '/room/[id]'") && alerts.includes('pushOsNav'), 'alerts→room SoT');
console.assert(byStage.includes("pathname: '/stage/[id]'") && byStage.includes('pushOsNav'), 'expense stage SoT');
console.assert(byRoom.includes("pathname: '/room/[id]'") && byRoom.includes('pushOsNav'), 'expense room SoT');
console.assert(detail.includes("pathname: '/room/[id]'") && detail.includes("pathname: '/stage/[id]'"), 'detail sheet SoT');
console.assert(docs.includes('repairTabRoute') && docs.includes('budgetTabRoute'), 'closeout SoT');
console.assert(qc.includes("pathname: '/stage/[id]'") && qc.includes('/quality-control'), 'QC→stage SoT');
console.assert(floor.includes("pushOsNav('/quality-control'") && !floor.includes("router.push('/quality-control'"), 'floor→QC SoT');
console.assert(mgr.includes('pushOsNav(topRisk.href') && mgr.includes('pushOsNav(topInsight.href'), 'manager SoT');
console.assert(hero.includes("pushOsNav('/inbox'"), 'home inbox SoT');
console.assert(wo.includes("pathname: '/chat/[threadId]'") && wo.includes("pathname: '/stage/[id]'"), 'WO links SoT');
console.assert(empty.includes("pushOsNav('/wizard/type'"), 'empty wizard SoT');
console.assert(budget.includes("pushOsNav('/budget-planner'") && budget.includes('role={role}'), 'budget planner+alerts');

console.log('journeyUnify.w117.test.ts OK');
