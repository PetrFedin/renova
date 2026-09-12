import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const sheet = readFileSync(join(mobile, 'components/renova/MaterialPickDetailSheet.tsx'), 'utf8');
const surface = readFileSync(join(mobile, 'components/renova/SheetSurface.tsx'), 'utf8');
const materials = readFileSync(join(mobile, 'components/screens/OsMaterialsScreen.tsx'), 'utf8');
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

must(
  materials.includes("type LoadState = 'loading' | 'loaded' | 'stale' | 'error'")
    && materials.includes('loadedContextKeyRef')
    && materials.includes('loadGenerationRef')
    && materials.includes('currentContextKeyRef.current !== contextKey'),
  'materials read state must fence stale project/account responses and distinguish stale from first-load error',
);
must(
  materials.includes('loadState === \'loading\' || loadedContextKey !== currentContextKey')
    && materials.includes('Загрузка материалов…'),
  'materials first load must not render fabricated zero summaries',
);
must(
  materials.includes("const stateUncertain = loadState === 'stale'")
    && materials.includes('readOnly={readOnly || stateUncertain}')
    && materials.includes('disabled={busy || stateUncertain}'),
  'stale materials data must fail closed for procurement/receipt mutations',
);
must(
  materials.includes('isOfflineQueued(error)')
    && materials.includes("notifyOfflineQueued(actionLabel, role)"),
  'queued material mutations must be reported as queued rather than failed',
);
must(
  materials.includes("showCommittedRefreshFailure('Закупка создана')")
    && materials.includes("showCommittedRefreshFailure('Статус закупки сохранён')")
    && !materials.includes('Статус не изменён. Проверьте сеть и повторите.'),
  'confirmed purchase commits must never become false mutation failures after refresh debt',
);
const createStart = materials.indexOf('const createPurchaseFromReady');
const createCommit = materials.indexOf('created = await api.createPurchase', createStart);
const createLocalPublish = materials.indexOf('setPurchases((prev) => upsertPurchase(prev, created))', createStart);
const createReconcile = materials.indexOf("reconcileAfterCommit('createPurchase')", createStart);
must(
  createStart >= 0 && createCommit > createStart && createLocalPublish > createCommit && createReconcile > createLocalPublish,
  'purchase create must publish the confirmed entity before best-effort reconciliation',
);
const advanceStart = materials.indexOf('const advancePurchase');
const statusCommit = materials.indexOf('updated = await api.updatePurchaseStatus', advanceStart);
const statusLocalPublish = materials.indexOf('setPurchases((prev) => upsertPurchase(prev, updated))', advanceStart);
const statusReconcile = materials.indexOf("reconcileAfterCommit('advancePurchase')", advanceStart);
must(
  advanceStart >= 0 && statusCommit > advanceStart && statusLocalPublish > statusCommit && statusReconcile > statusLocalPublish,
  'purchase status commit must be acknowledged independently from side-effect/read reconciliation',
);
must(
  materials.includes('Результат нужно проверить')
    && materials.includes('Не повторяйте действие, пока не обновите данные.'),
  'ambiguous material mutation outcome must reconcile before any repeat',
);

console.log('materialPickDetailContract.test OK');
