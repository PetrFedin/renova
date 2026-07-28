/** W121: Fieldwire punch→QC focus + Buildertrend CO→estimate/budget chain */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');

const qcNav = readFileSync(join(mobile, 'lib/qcNav.ts'), 'utf8');
const floor = readFileSync(join(mobile, 'components/renova/FloorPlanPanel.tsx'), 'utf8');
const links = readFileSync(join(mobile, 'lib/pushLinks.ts'), 'utf8');
const qc = readFileSync(join(mobile, 'components/screens/QualityControlScreen.tsx'), 'utf8');
const control = readFileSync(join(mobile, 'components/screens/control/CustomerControlView.tsx'), 'utf8');
const budget = readFileSync(join(mobile, 'components/screens/budget/BudgetSummarySection.tsx'), 'utf8');
const changes = readFileSync(join(mobile, 'components/screens/estimate/EstimateChangesLayer.tsx'), 'utf8');

console.assert(qcNav.includes('/quality-control') && qcNav.includes('issueId'), 'qcNav SoT');
console.assert(floor.includes('ActionConfirmSheet') && floor.includes('openQcIssue(punchSheet?.issueId') && floor.includes('openQcIssue(item.id'), 'punch→sheet→QC');
console.assert(links.includes('issueId') && links.includes("pathname: '/quality-control'"), 'pushLinks issueId preserve');
console.assert(qc.includes('focusedCard') && qc.includes('issuePhoto') && qc.includes("objectTabRoute(role, 'plan', 'floor')"), 'QC photo+plan');
console.assert(control.includes('openQcIssue(iss.id') && control.includes('rowFocus') && control.includes('На план'), 'control→QC+plan');
console.assert(budget.includes("estimateLayer: 'changes'"), 'budget CO→estimate changes');
console.assert(changes.includes("budgetTabRoute(role, 'summary')") && changes.includes('В бюджет'), 'CO history→budget');

if (
  !(
    qcNav.includes('/quality-control') &&
    floor.includes('ActionConfirmSheet') &&
    floor.includes('openQcIssue(punchSheet?.issueId') &&
    qc.includes("objectTabRoute(role, 'plan', 'floor')") &&
    control.includes('На план')
  )
) {
  process.exit(1);
}

console.log('journeyUnify.w121.test.ts OK');
