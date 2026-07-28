/** Clarity G: ActionConfirm migration nav + floor empty CTA + orphan schedule gone */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const accept = readFileSync(join(mobile, 'lib/acceptanceNav.ts'), 'utf8');
const field = readFileSync(join(mobile, 'lib/fieldCreateNav.ts'), 'utf8');
const proc = readFileSync(join(mobile, 'lib/procurementNav.ts'), 'utf8');
const floor = readFileSync(join(mobile, 'components/renova/FloorPlanPanel.tsx'), 'utf8');

console.assert(accept.includes('showActionConfirm') && !accept.includes('Alert.alert'), 'acceptance sheet');
console.assert(field.includes('showActionConfirm') && !field.includes('Alert.alert'), 'fieldCreate sheet');
console.assert(proc.includes('showActionConfirm') && !proc.includes('Alert.alert'), 'procurement sheet');
console.assert(floor.includes("'+ Загрузить план'") && floor.includes('Заменить план этажа'), 'floor empty CTA');
console.assert(!existsSync(join(mobile, 'components/renova/PlanSchedulePanel.tsx')), 'orphan PlanSchedulePanel removed');

const ok =
  accept.includes('showActionConfirm') &&
  !accept.includes('Alert.alert') &&
  field.includes('showActionConfirm') &&
  !existsSync(join(mobile, 'components/renova/PlanSchedulePanel.tsx'));
if (!ok) process.exit(1);
console.log('clarityWaveG.w160.test OK');
