import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const sheet = readFileSync(join(mobile, 'components/renova/MaterialPickDetailSheet.tsx'), 'utf8');

console.assert(sheet.includes("variant=\"dangerOutline\""), 'fact rollback uses danger outline');
console.assert(sheet.includes('primaryDestructive: true'), 'rollback confirmation is destructive');
console.assert(sheet.includes("const [busyAction, setBusyAction]"), 'material actions have busy state');
console.assert(sheet.includes("if (busyAction) return"), 'duplicate material mutations guarded');
console.assert(sheet.includes('onRequestClose={closeSafely}'), 'sheet dismissal guarded while busy');
console.assert(sheet.includes('resolveSafeDocumentUrl(pick.shop_url)'), 'shop URL is validated');
console.assert(sheet.includes('title="Закрыть" variant="ghost"'), 'close remains tertiary');
console.assert(sheet.includes('minHeight: RenovaTheme.minTouch'), 'linked rows meet touch target');

console.log('materialPickDetailContract.test OK');
