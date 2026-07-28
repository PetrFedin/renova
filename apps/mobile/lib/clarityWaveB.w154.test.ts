/** Clarity B: LoadErrorState / EmptyActionState / ActionConfirmSheet */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const loadErr = readFileSync(join(mobile, 'components/ui/LoadErrorState.tsx'), 'utf8');
const empty = readFileSync(join(mobile, 'components/ui/EmptyActionState.tsx'), 'utf8');
const sheet = readFileSync(join(mobile, 'components/renova/ActionConfirmSheet.tsx'), 'utf8');
const floor = readFileSync(join(mobile, 'components/renova/FloorPlanPanel.tsx'), 'utf8');
const control = readFileSync(join(mobile, 'components/screens/control/CustomerControlView.tsx'), 'utf8');
const materials = readFileSync(join(mobile, 'components/screens/OsMaterialsScreen.tsx'), 'utf8');
const cal = readFileSync(join(mobile, 'components/screens/schedule/UnifiedScheduleView.tsx'), 'utf8');
const design = readFileSync(join(mobile, 'components/renova/DesignPackageList.tsx'), 'utf8');

console.assert(loadErr.includes('Повторить') && loadErr.includes('showChatCta'), 'LoadErrorState');
console.assert(empty.includes('actionLabel') && empty.includes('EmptyActionState'), 'EmptyActionState');
console.assert(sheet.includes('animationType="slide"') && sheet.includes('primaryLabel'), 'ActionConfirmSheet');
console.assert(floor.includes('ActionConfirmSheet') && floor.includes('LoadErrorState'), 'floor wired');
console.assert(control.includes('LoadErrorState'), 'control LoadError');
console.assert(materials.includes('LoadErrorState'), 'materials LoadError');
console.assert(cal.includes('LoadErrorState'), 'calendar LoadError');
console.assert(design.includes('EmptyActionState') && design.includes('LoadErrorState'), 'design states');

const ok = loadErr.includes('Повторить') && floor.includes('setPunchSheet') && sheet.includes('slide');
if (!ok) process.exit(1);
console.log('clarityWaveB.w154.test OK');
