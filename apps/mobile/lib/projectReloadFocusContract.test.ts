import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const hook = readFileSync(join(mobile, 'lib/useProjectDataReload.ts'), 'utf8');
const bus = readFileSync(join(mobile, 'lib/projectDataBus.ts'), 'utf8');
const must = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

must(hook.includes("import { useFocusEffect } from 'expo-router'"), 'reload hook uses navigation focus');
must(hook.includes('const focusedRef = useRef(false)'), 'focus state ref');
must(hook.includes('const staleRef = useRef(false)'), 'stale state ref');
must(hook.includes('const timerRef = useRef'), 'shared debounce timer ref');
must(hook.includes('if (!focusedRef.current)') && hook.includes('staleRef.current = true'), 'hidden screen defers reload');
must(hook.includes('if (staleRef.current)') && hook.includes('scheduleReload(0)'), 'stale screen refreshes on focus');
must(hook.includes('cancelScheduledReload(true)'), 'blur cancels scheduled reload and preserves stale state');
must(hook.includes('RELOAD_DEBOUNCE_MS = 450'), 'visible screen retains storm debounce');
must(hook.includes('isRateLimitError') && hook.includes('projectDataReload.rate_limit'), '429 handling retained');
must(hook.includes('reloadRef.current = reload'), 'latest reload callback retained without resubscribe');
must(hook.includes('unsubscribe();'), 'project data subscription cleanup');
must(bus.includes('reloadInboxSync') && bus.includes('notifyProjectDataChanged'), 'golden path still refreshes inbox and project data');

console.log('projectReloadFocusContract.test OK');
