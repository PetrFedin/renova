/** Clarity B: LoadErrorState / EmptyActionState / ActionConfirmSheet */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const src = (relativePath: string) => readFileSync(join(mobile, relativePath), 'utf8');
const must = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

const loadErr = src('components/ui/LoadErrorState.tsx');
const empty = src('components/ui/EmptyActionState.tsx');
const sheet = src('components/renova/ActionConfirmSheet.tsx');
const surface = src('components/renova/SheetSurface.tsx');
const floor = src('components/renova/FloorPlanPanel.tsx');
const control = src('components/screens/control/CustomerControlView.tsx');
const materials = src('components/screens/OsMaterialsScreen.tsx');
const calendar = src('components/screens/schedule/UnifiedScheduleView.tsx');
const design = src('components/renova/DesignPackageList.tsx');

must(loadErr.includes('Повторить') && loadErr.includes('showChatCta'), 'LoadErrorState');
must(empty.includes('actionLabel') && empty.includes('EmptyActionState'), 'EmptyActionState');
must(sheet.includes('SheetSurface') && sheet.includes('primaryLabel'), 'ActionConfirmSheet shared surface');
must(surface.includes('animationType="slide"') && surface.includes('KeyboardAvoidingView'), 'shared slide/keyboard chrome');
must(sheet.includes('runThenClose') && sheet.includes('queueMicrotask'), 'nested confirmation deferral');
must(floor.includes('ActionConfirmSheet') && floor.includes('LoadErrorState'), 'floor wired');
must(control.includes('LoadErrorState'), 'control LoadError');
must(materials.includes('LoadErrorState'), 'materials LoadError');
must(calendar.includes('LoadErrorState'), 'calendar LoadError');
must(design.includes('EmptyActionState') && design.includes('LoadErrorState'), 'design states');

console.log('clarityWaveB.w154.test OK');
