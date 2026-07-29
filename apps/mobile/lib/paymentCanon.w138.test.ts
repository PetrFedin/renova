/** W138: один канон оплаты — PaymentDetailSheet; finance-center не confirm напрямую */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const read = (relativePath: string) => readFileSync(join(mobile, relativePath), 'utf8');
const must = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

const sheet = read('components/renova/PaymentDetailSheet.tsx');
const surface = read('components/renova/SheetSurface.tsx');
const budget = read('components/screens/OsBudgetScreen.tsx');
const paymentsSection = read('components/screens/budget/BudgetPaymentsSection.tsx');
const createForm = read('components/renova/CreatePaymentForm.tsx');
const payApi = read('lib/api/payments.ts');
const push = read('lib/pushLinks.ts');
const catchAll = read('lib/resolveCatchAllSlug.ts');
const snap = read('lib/domain/buildProjectOsSnapshot.ts');
const kpi = read('lib/domain/buildHomeKpiDetail.ts');
const chat = read('components/renova/chat/ChatThreadView.tsx');
const actionBus = read('lib/actionConfirmBus.ts');
const actionSheet = read('components/renova/ActionConfirmSheet.tsx');
const svc = read('../../backend/app/services/payment_service.py');
const yk = read('../../backend/app/services/yookassa_service.py');

must((sheet.match(/confirmPayment\(/g) || []).length >= 1, 'sheet calls confirmPayment');
must(payApi.includes('transfer_ack'), 'API sends transfer_ack');
must(sheet.includes('transfer_ack'), 'sheet passes transfer_ack');
must(sheet.includes('внешнего перевода') || sheet.includes('внешний перевод'), 'honest external-transfer copy');

must(sheet.includes('const mutationRef = useRef(false)'), 'payment mutation ref');
must(sheet.includes("type PaymentMutation = 'card' | 'confirm' | 'dispute' | null"), 'exact payment mutation state');
must(sheet.includes('if (mutationRef.current) return false'), 'duplicate payment mutation guard');
must(sheet.includes("loading={mutation === 'confirm'}"), 'confirm button loading state');
must(sheet.includes("loading={mutation === 'card'}"), 'card button loading state');
must(sheet.includes("loading={mutation === 'dispute'}"), 'dispute button loading state');
must(sheet.includes('SheetSurface'), 'payment uses shared surface');
must(surface.includes('if (!busy) onClose()'), 'modal close guarded while busy');
must(sheet.includes('title="Закрыть"') && sheet.includes('variant="ghost"'), 'close remains tertiary');
must(!sheet.includes('Alert.alert'), 'payment has no Alert fallback');

must(paymentsSection.includes('filterChipStyles'), 'payment filters use shared chips');
must(paymentsSection.includes('const [createOpen, setCreateOpen]'), 'create form is progressively disclosed');
must(paymentsSection.includes("title={createOpen ? 'Скрыть форму' : 'Выставить счёт'}"), 'single create action');
must(paymentsSection.includes('title="Импорт выписки"') && paymentsSection.includes('variant="outline"'), 'bank import is secondary');
must(!paymentsSection.includes('variant={payFilter ==='), 'filters are not primary buttons');
must(paymentsSection.includes('accessibilityState={{ selected }}'), 'filter selected state');
must(paymentsSection.includes('Показать все счета'), 'filtered empty state recovery');
must(paymentsSection.includes('formatConfirmedDate'), 'payment dates fail safely');

must(createForm.includes('const busyRef = useRef(false)'), 'create payment ref guard');
must(createForm.includes('if (busyRef.current) return'), 'create payment duplicate submit guard');
must(createForm.includes('filterChipStyles') && createForm.includes('formSurfaceStyles'), 'payment form shared UI');
must(createForm.includes('loading={busy}'), 'create payment shared loading');
must(createForm.includes('Введённые данные сохранены в форме'), 'create payment preserves draft on error');
must(createForm.includes('title="Отмена"') && createForm.includes('variant="ghost"'), 'create payment cancel tertiary');
must(createForm.includes('let created = false') && createForm.includes('if (!created) return'), 'payment durable write boundary');
must(createForm.indexOf('if (!created) return') < createForm.indexOf('clearDraft();', createForm.indexOf('if (!created) return')), 'payment clears only after durable write');
must(createForm.includes('void syncProjectSideEffects') && createForm.includes("reportCatch('CreatePaymentForm.sideEffects')"), 'payment side effects best effort');
must(createForm.includes("stage_id: paymentType === 'stage' ? stageId : null"), 'material payment has no hidden stage');
must(createForm.includes("if (next !== 'stage')") && createForm.includes('setStageId(null)'), 'payment type switch clears stage');

must(actionBus.includes('primaryDestructive?: boolean'), 'confirm payload destructive flag');
must(actionSheet.includes("primaryDestructive ? 'danger' : 'primary'"), 'destructive primary uses danger');
must(actionSheet.includes("action.destructive ? 'dangerOutline'"), 'destructive menu action uses danger outline');

must(budget.includes('openPaymentParam'), 'budget auto-opens sheet');
must(push.includes("openPayment: '1'"), 'finance-center opens sheet');
must(catchAll.includes("openPayment: '1'"), 'slug finance-center opens sheet');
must(snap.includes("openPayment: '1'"), 'home Оплатить opens sheet');
must(kpi.includes("openPayment: '1'"), 'KPI Оплатить opens sheet');
must(chat.includes("openPayment: '1'"), 'chat pay opens sheet');
must(push.includes("case 'payment_pending'") && push.includes("openPayment: '1'"), 'push pending opens sheet');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path, out);
    else if (/\.(tsx|ts)$/.test(name)) out.push(path);
  }
  return out;
}
const offenders: string[] = [];
for (const file of walk(join(mobile, 'components'))) {
  if (file.endsWith('PaymentDetailSheet.tsx')) continue;
  const body = readFileSync(file, 'utf8');
  if (/confirmPayment\s*\(/.test(body)) offenders.push(file);
}
must(offenders.length === 0, 'confirmPayment only in sheet: ' + offenders.join(', '));

must(!/has_yk|yookassa_payment_id.*transfer_ack|receipt_id or has_yk/.test(
  svc.slice(svc.indexOf('allow_without_settlement'), svc.indexOf('allow_without_settlement') + 500),
), 'manual confirm must not treat yookassa_id as proof');
must(svc.includes('if not allow_without_settlement') && svc.includes('not (receipt_id or transfer_ack)'), 'manual proof = receipt or ack');
must(svc.includes('update(Payment)') && svc.includes('Payment.status.in_(allowed_from)'), 'payment transition has one conditional DB winner');
must(svc.includes('suppress_payment_transition_side_effects'), 'replayed transition suppresses duplicate effects');
must(svc.includes('refresh_budget_facts'), 'confirmed transition recalculates canonical budget fact');
must(yk.includes('allow_without_settlement=True'), 'webhook uses machine settlement');

console.log('paymentCanon.w138.test OK');
