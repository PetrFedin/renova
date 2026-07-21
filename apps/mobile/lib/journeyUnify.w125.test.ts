/** W125: acceptance → pay/plan SoT + ✓ pin on floor plan (Fieldwire-style) */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');

const nav = readFileSync(join(mobile, 'lib/acceptanceNav.ts'), 'utf8');
const list = readFileSync(join(mobile, 'components/renova/UnifiedAcceptanceList.tsx'), 'utf8');
const decide = readFileSync(join(mobile, 'lib/acceptanceDecide.ts'), 'utf8');
const stages = readFileSync(join(mobile, 'lib/api/stages.ts'), 'utf8');
const stageUi = readFileSync(join(mobile, 'components/screens/StageDetailScreen.tsx'), 'utf8');
const floor = readFileSync(join(mobile, 'components/renova/FloorPlanPanel.tsx'), 'utf8');
const waRoute = readFileSync(join(mobile, 'app/work-acceptance.tsx'), 'utf8');

function must(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

must(nav.includes('alertStageAccepted') && nav.includes("objectTabRoute(role, 'plan')"), 'nav→plan');
must(nav.includes("budgetTabRoute(role, 'payments'"), 'nav→payments');
must(list.includes('alertStageAccepted'), 'list uses shared alert');
must(list.includes('acceptanceDecisionBody'), 'list uses decide helper');
must(list.includes('QualityScorePicker'), 'optional score UI in hub');
must(stageUi.includes('alertStageAccepted'), 'stage card uses shared alert after accept');
must(!stages.includes('quality_score: 10') && !stages.includes('quality_score: 5'), 'no fake 10/5 in stages API');
must(decide.includes('qualityScore') && decide.includes('<= 10'), 'decide helper bounds');
must(waRoute.includes("tab: 'control'"), 'legacy /work-acceptance → repair control');
must(!existsSync(join(mobile, 'components/screens/WorkAcceptanceScreen.tsx')), 'orphan WorkAcceptanceScreen removed');
must(floor.includes('pinAccepted') && floor.includes('acceptLegend'), 'floor ✓ style');
must(floor.includes("startsWith('✓')"), 'detect acceptance pin label');

console.log('journeyUnify.w125.test.ts OK');
