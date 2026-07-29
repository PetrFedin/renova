/** Clarity W: procurement, QC and Work Order transition integrity */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  WORK_TRANSITIONS,
  hasCanonicalPaymentAction,
  isTransitionAllowedForRole,
  workActions,
} from './domain/workLifecycle';

const mobile = join(__dirname, '..');
const src = (rel: string) => readFileSync(join(mobile, rel), 'utf8');

const matPage = src('app/material/[id].tsx');
if (!matPage.includes("title: 'Убрать из факта?'")) throw new Error('material page cancel confirm');

const mats = src('components/screens/OsMaterialsScreen.tsx');
const purchaseList = src('components/renova/PurchaseList.tsx');
if (!mats.includes("status === 'cancelled'") || !mats.includes("title: 'Убрать из факта?'")) {
  throw new Error('OsMaterials cancel confirm');
}
if (mats.includes('} import {')) throw new Error('OsMaterials broken import');
if ((mats.match(/<ScrollView/g) || []).length !== 1) throw new Error('materials must use one vertical scroll');
if (!mats.includes('filterChipStyles') || !mats.includes('accessibilityState={{ selected, disabled: busy }}')) {
  throw new Error('materials filters shared/accessibility');
}
if (!mats.includes('const mutationRef = useRef(false)') || !mats.includes('if (mutationRef.current) return')) {
  throw new Error('materials duplicate mutation guard');
}
if (!mats.includes('primaryDestructive: true')) throw new Error('materials cancel destructive confirm');
if ((mats.match(/Создать закупку \(/g) || []).length > 0) throw new Error('duplicate create purchase CTA');
if (!mats.includes('Следующий шаг') || !mats.includes('next.cta')) throw new Error('canonical procurement next action');
if (!mats.includes('Нужно купить') || !mats.includes('В факте')) throw new Error('materials focused summary');
if (!purchaseList.includes('variant="dangerOutline"')) throw new Error('purchase cancel danger hierarchy');
if (!purchaseList.includes('mutationKey === nextKey') || !purchaseList.includes('mutationKey === cancelKey')) {
  throw new Error('purchase exact loading states');
}
if (!purchaseList.includes('disabled={busy}')) throw new Error('purchase navigation guarded while busy');

const waste = src('components/renova/WasteOrderList.tsx');
if (!waste.includes("title: 'Согласовать вывоз?'")) throw new Error('waste approve confirm');

const qc = src('components/screens/QualityControlScreen.tsx');
if (!qc.includes("title: 'Эскалировать в спор?'")) throw new Error('qc escalate pre-confirm');
if (!qc.includes("'Отметить исправленным?'") && !qc.includes("'Закрыть замечание?'")) {
  throw new Error('qc close pre-confirm');
}

const cust = src('components/screens/control/CustomerControlView.tsx');
if (!cust.includes("'Подтвердить исправление?'") && !cust.includes("'Закрыть замечание?'")) {
  throw new Error('customer control pre-confirm');
}

const contr = src('components/screens/control/ContractorControlView.tsx');
if (!contr.includes("title: 'Отметить исправленным?'")) throw new Error('contractor control pre-confirm');

// Work Order domain and UI must mirror the backend role matrix.
if (WORK_TRANSITIONS.done.includes('paid')) throw new Error('paid must not be a generic work transition');
if (!hasCanonicalPaymentAction('done', 'customer') || hasCanonicalPaymentAction('done', 'contractor')) {
  throw new Error('work payment navigation role');
}
if (!isTransitionAllowedForRole('published', 'approved', 'customer')) throw new Error('customer approves work');
if (isTransitionAllowedForRole('published', 'approved', 'contractor')) throw new Error('contractor cannot self-approve');
if (!isTransitionAllowedForRole('approved', 'in_progress', 'contractor')) throw new Error('contractor starts approved work');
if (isTransitionAllowedForRole('approved', 'in_progress', 'customer')) throw new Error('customer cannot start contractor work');
if (!isTransitionAllowedForRole('in_progress', 'review', 'contractor')) throw new Error('contractor submits review');
if (isTransitionAllowedForRole('in_progress', 'review', 'customer')) throw new Error('customer cannot self-submit');
if (!isTransitionAllowedForRole('review', 'done', 'customer')) throw new Error('customer accepts result');
if (isTransitionAllowedForRole('review', 'done', 'contractor')) throw new Error('contractor cannot self-accept');
const reviewCustomerActions = workActions('review', 'customer');
if (reviewCustomerActions.find((action) => action.next === 'in_progress')?.intent !== 'secondary') {
  throw new Error('customer rework action hierarchy');
}
if (workActions('draft', 'customer').find((action) => action.next === 'cancelled')?.intent !== 'destructive') {
  throw new Error('work cancel destructive intent');
}

const wo = src('components/screens/WorkOrderDetailScreen.tsx');
if (!wo.includes("cancelled: 'Отменить работу?'") || !wo.includes("done: 'Принять результат?'")) {
  throw new Error('WO transition confirms');
}
if (!wo.includes('const mutationRef = useRef(false)') || !wo.includes('if (!user || !activeProject || !workOrder || mutationRef.current)')) {
  throw new Error('WO duplicate mutation guard');
}
if (!wo.includes('loading={mutation === action.next}') || !wo.includes("variant={action.intent === 'destructive' ? 'dangerOutline'")) {
  throw new Error('WO loading/destructive hierarchy');
}
if (!wo.includes("primaryDestructive: action.intent === 'destructive'")) throw new Error('WO destructive confirmation');
if (!wo.includes('const changed = await transition(action.next)') || !wo.includes("action.next === 'negotiating'")) {
  throw new Error('WO chat opens after persisted negotiating transition');
}
if (!wo.includes('hasCanonicalPaymentAction') || wo.includes("a.next === 'paid'")) {
  throw new Error('WO payment must use canonical navigation');
}
if (!wo.includes("loadState === 'error'") || !wo.includes('Это не означает, что работа удалена')) {
  throw new Error('WO load failure must differ from missing data');
}

const workService = src('../../backend/app/services/work_order_service.py');
const workApi = src('../../backend/app/api/v1/work_orders.py');
if (!workService.includes('ROLE_ALLOWED') || !workService.includes('validate_transition(current, new_status, actor_role)')) {
  throw new Error('backend WO role matrix');
}
if (!workService.includes('payment_transition_required') || !workService.includes('notif_svc.notify')) {
  throw new Error('backend WO payment boundary/notifications');
}
if (!workService.includes('kind="work_status"') || !workService.includes('actor_role=')) {
  throw new Error('backend WO audit evidence');
}
if (!workApi.includes('user.role') || !workApi.includes('HTTPException(409, code)')) {
  throw new Error('WO API role/payment enforcement');
}

const panels = src('components/renova/os/ProjectOsPanels.tsx');
if (panels.includes('identityCard: {\n    ...card') || panels.includes('identityCard: {\n    ...card,')) {
  throw new Error('identity still card');
}
if (!panels.includes('Clarity W: flat identity')) throw new Error('identity flat missing');

const passport = src('components/renova/os/RoomPassport.tsx');
if (passport.includes('hero: { ...card') || passport.includes("fontWeight: '800'")) {
  throw new Error('RoomPassport hero card/800');
}

const strip = src('components/renova/schedule/ScheduleExecutionStrip.tsx');
if (!strip.includes('listRowStyles.metricCell') || strip.includes('...card')) {
  throw new Error('ScheduleExecutionStrip SoT');
}

const works = src('components/screens/object/EstimateWorksByRoom.tsx');
const matsEst = src('components/screens/object/EstimateMaterialsByRoom.tsx');
for (const [name, body] of [['works', works], ['mats', matsEst]] as const) {
  if (body.includes('...card') || body.includes('#F8FAFC')) throw new Error(`estimate ${name} still card`);
  if (!body.includes('screenTypography')) throw new Error(`estimate ${name} SoT`);
}

const docs = src('components/renova/DocumentsHub.tsx');
if (docs.includes('indexCard: { ...card') || docs.includes("indexTitle: { fontSize: 16, fontWeight: '800'")) {
  throw new Error('DocumentsHub index card');
}
if (!docs.includes('listRowStyles.metricCell')) throw new Error('DocumentsHub metricCell');

const exp = src('components/renova/ExpenseDetailTable.tsx');
if (!exp.includes('filterChipStyles')) throw new Error('ExpenseDetailTable chips');
if (exp.includes('borderRadius: 10, padding: 10, marginBottom: 8, borderWidth: 1')) {
  throw new Error('ExpenseDetailTable group card');
}

console.log('clarityWaveW.w176.test OK');
