/** Clarity H: remaining *Nav post-action → showActionConfirm */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const files = [
  'lib/fieldCommsNav.ts',
  'lib/estimatePayNav.ts',
  'lib/siteOpsNav.ts',
  'lib/shareAccessNav.ts',
  'lib/calendarIcsNav.ts',
  'lib/jobLeadNav.ts',
];

for (const rel of files) {
  const src = readFileSync(join(mobile, rel), 'utf8');
  if (!src.includes('showActionConfirm')) throw new Error(`${rel}: missing showActionConfirm`);
  if (src.includes('Alert.alert')) throw new Error(`${rel}: still Alert.alert`);
  if (src.includes("from 'react-native'")) throw new Error(`${rel}: still imports react-native Alert`);
}

console.log('clarityWaveH.w161.test OK', files.length, 'nav helpers');
