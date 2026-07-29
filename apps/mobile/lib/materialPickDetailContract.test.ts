import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const sheet = readFileSync(join(mobile, 'components/renova/MaterialPickDetailSheet.tsx'), 'utf8');
const surface = readFileSync(join(mobile, 'components/renova/SheetSurface.tsx'), 'utf8');
const must = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

must(sheet.includes('variant="dangerOutline"'), 'fact rollback uses danger outline');
must(sheet.includes('primaryDestructive: true'), 'rollback confirmation is destructive');
must(sheet.includes("const [busyAction, setBusyAction]"), 'material actions have exact busy state');
must(sheet.includes('const mutationRef = useRef(false)'), 'material duplicate mutation ref');
must(sheet.includes('if (mutationRef.current) return false'), 'duplicate material mutations guarded');
must(sheet.includes('SheetSurface'), 'material uses shared surface');
must(surface.includes('if (!busy) onClose()'), 'sheet dismissal guarded while busy');
must(sheet.includes('resolveSafeDocumentUrl(pick.shop_url)'), 'shop URL is validated');
must(sheet.includes('title="Закрыть"') && sheet.includes('variant="ghost"'), 'close remains tertiary');
must(sheet.includes('sheetContentStyles.row'), 'linked rows use shared touch-safe rows');
must(sheet.includes('accessibilityLabel={`Открыть комнату ${room.name}`}'), 'room link accessible');
must(sheet.includes('accessibilityLabel={`Открыть этап ${stage.name}`}'), 'stage link accessible');
must(sheet.includes('accessibilityRole="link"'), 'shop link accessible');

console.log('materialPickDetailContract.test OK');
