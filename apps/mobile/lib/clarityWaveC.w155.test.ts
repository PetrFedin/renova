/** Clarity C: screenTypography, underline hubs, list rows без card-стека */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const screen = readFileSync(join(mobile, 'constants/screenTypography.ts'), 'utf8');
const home = readFileSync(join(mobile, 'constants/homeTypography.ts'), 'utf8');
const type = readFileSync(join(mobile, 'constants/typography.ts'), 'utf8');
const hub = readFileSync(join(mobile, 'components/renova/os/OsHubTabs.tsx'), 'utf8');
const control = readFileSync(join(mobile, 'components/screens/control/CustomerControlView.tsx'), 'utf8');
const planFrame = readFileSync(join(mobile, 'components/screens/object/PlanSectionFrame.tsx'), 'utf8');
const docs = readFileSync(join(mobile, 'components/renova/DocumentsHub.tsx'), 'utf8');
const empty = readFileSync(join(mobile, 'components/ui/EmptyActionState.tsx'), 'utf8');

console.assert(screen.includes('listRowStyles') && screen.includes('screenTypography'), 'screenTypography');
console.assert(!home.includes("textTransform: 'uppercase'"), 'home zone no uppercase');
console.assert(!type.includes("textTransform: 'uppercase'"), 'typography zone no uppercase');
console.assert(hub.includes('borderBottomWidth: 2') && !hub.includes('borderRadius: 20'), 'underline hubs');
console.assert(control.includes('listRowStyles') && control.includes('screenTypography'), 'control list');
console.assert(!planFrame.includes('fontStyle: \'italic\'') && planFrame.includes('numberOfLines={2}'), 'plan frame quiet');
console.assert(docs.includes('hairlineWidth') && docs.includes("fontWeight: '600'"), 'docs list quiet');
console.assert(empty.includes('hairlineWidth') && empty.includes('screenTypography'), 'empty soft');

const ok =
  screen.includes('listRowStyles') &&
  hub.includes('borderBottomColor: RenovaTheme.colors.primary') &&
  control.includes('listRowStyles');
if (!ok) process.exit(1);
console.log('clarityWaveC.w155.test OK');
