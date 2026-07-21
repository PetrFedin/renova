/** W118: notifications/approvals/WO/material/purchase/menu → pushOsNav SoT */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');

const files: Record<string, string> = {
  notifyList: 'components/renova/NotificationsList.tsx',
  notifyCenter: 'components/renova/NotificationCenter.tsx',
  decisions: 'components/renova/DecisionHistoryPanel.tsx',
  approvals: 'app/approvals.tsx',
  stageLinks: 'components/screens/stage/StageDetailLinks.tsx',
  woCard: 'components/renova/WorkOrderCard.tsx',
  woDetail: 'components/screens/WorkOrderDetailScreen.tsx',
  activity: 'app/activity.tsx',
  reports: 'app/_stack/reports.tsx',
  material: 'app/material/[id].tsx',
  pickSheet: 'components/renova/MaterialPickDetailSheet.tsx',
  stageExp: 'components/renova/StageExpensePanel.tsx',
  purchase: 'components/renova/PurchaseList.tsx',
  offline: 'components/renova/OfflineSyncBanner.tsx',
  moreMenu: 'components/renova/os/OsSectionMenu.tsx',
  home: 'components/screens/OsHomeScreen.tsx',
  estimate: 'components/screens/estimate/EstimateSummaryLayer.tsx',
  expenseNav: 'lib/expenseRowNav.ts',
};

const src: Record<string, string> = {};
for (const [k, rel] of Object.entries(files)) {
  src[k] = readFileSync(join(mobile, rel), 'utf8');
}

function noRawPush(name: string, body: string) {
  console.assert(!body.includes('router.push'), `${name}: no raw router.push`);
}

for (const [k, body] of Object.entries(src)) noRawPush(k, body);

console.assert(src.notifyList.includes('pushOsNav') && src.notifyList.includes('resolveNotificationLink'), 'notify list SoT');
console.assert(src.notifyCenter.includes("pushOsNav(changeOrderEstimateRoute"), 'notify CO SoT');
console.assert(src.decisions.includes('pushOsNav(item.linkPath'), 'decisions SoT');
console.assert(src.approvals.includes("pushOsNav(budget") || src.approvals.includes('pushOsNav(budget,'), 'approvals budget SoT');
console.assert(src.approvals.includes("estimateLayer: 'changes'"), 'approvals changes layer');
console.assert(src.stageLinks.includes("pathname: '/chat/[threadId]'") && src.stageLinks.includes('pushOsNav'), 'stage chat SoT');
console.assert(src.woCard.includes("pathname: '/work-order/[id]'") && src.woCard.includes('pushOsNav'), 'WO card SoT');
console.assert(src.woDetail.includes("budgetTabRoute(role, 'payments')"), 'WO paid → payments SoT');
console.assert(src.activity.includes("pushOsNav('/documents'"), 'activity→docs SoT');
console.assert(src.reports.includes("pushOsNav('/documents'"), 'reports→docs SoT');
console.assert(src.material.includes("pathname: '/stage/[id]'") && src.material.includes('pushOsNav'), 'material→stage SoT');
console.assert(src.pickSheet.includes("pathname: '/material/[id]'"), 'pick sheet SoT');
console.assert(src.purchase.includes("pathname: '/purchase/[id]'"), 'purchase SoT');
console.assert(src.offline.includes("pushOsNav('/conflicts'"), 'offline→conflicts SoT');
console.assert(src.moreMenu.includes('pushOsNav(link.href'), 'more menu SoT');
console.assert(src.home.includes("pushOsNav('/job-leads'"), 'home job-leads SoT');
console.assert(src.estimate.includes("estimateLayer: 'changes'"), 'estimate changes SoT');
console.assert(src.expenseNav.includes('pushOsNav') && src.expenseNav.includes('options.role'), 'expense row SoT+role');

console.log('journeyUnify.w118.test.ts OK');
