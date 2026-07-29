/** Clarity V: approve asymmetries; payment/viewer; Manager KPI + filterChip + BudgetBreakdown */
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildBudgetSummaryView } from './domain/buildBudgetSummaryView';

const mobile = join(__dirname, '..');
const src = (rel: string) => readFileSync(join(mobile, rel), 'utf8');

const stage = src('components/screens/StageDetailScreen.tsx');
if (!stage.includes("title: emptyChecklist ? 'Принять без чеклиста?' : 'Принять этап?'")) {
  throw new Error('stage accept always-confirm missing');
}

const sel = src('components/screens/OsSelectionsScreen.tsx');
if (!sel.includes("title: 'Согласовать подбор?'")) throw new Error('selection approve confirm');

const rooms = src('components/screens/OsRoomsScreen.tsx');
if (!rooms.includes("title: 'Согласовать запрос?'" ) || !rooms.includes("title: archived ? 'В архив?'")) {
  throw new Error('rooms approve/archive confirm');
}
if (rooms.includes('function DimRow') || rooms.includes('Сохранить и пересчитать смету')) {
  throw new Error('rooms list still contains inline editor');
}
if (!rooms.includes('const mutationRef = useRef(false)') || !rooms.includes('if (mutationRef.current) return')) {
  throw new Error('rooms list duplicate mutation guard');
}
if (!rooms.includes('primaryDestructive: archived')) throw new Error('rooms list archive destructive confirm');
if (!rooms.includes("variant={archived ? 'outline' : 'dangerOutline'}")) throw new Error('rooms list archive danger hierarchy');
if (!rooms.includes('primaryDestructive: true') || !rooms.includes('variant="dangerOutline"')) {
  throw new Error('room request rejection destructive hierarchy');
}
if (!rooms.includes('const accepted = await onSubmit(message, {})') || !rooms.includes("if (accepted) setMsg('')")) {
  throw new Error('room request draft preservation');
}
if (!rooms.includes('loading={mutationKey === `approve:${r.id}`}') || !rooms.includes('loading={archiveLoading}')) {
  throw new Error('rooms list loading states');
}

const roomDetail = src('components/screens/RoomDetailScreen.tsx');
if (!roomDetail.includes('primaryDestructive: nextArchived')) throw new Error('room archive destructive confirm');
if (!roomDetail.includes("variant={room.is_archived ? 'outline' : 'dangerOutline'}")) throw new Error('room archive danger hierarchy');
if (!roomDetail.includes('const mutationRef = useRef(false)')) throw new Error('room mutation ref guard');
if (!roomDetail.includes('if (mutationRef.current) return undefined')) throw new Error('room duplicate mutation guard');
if (!roomDetail.includes("loading={mutation === 'archive'}")) throw new Error('room archive loading state');
if (!roomDetail.includes("loading={mutation === 'save'}")) throw new Error('room save loading state');

const mats = src('components/renova/MaterialPickList.tsx');
const matSheet = src('components/renova/MaterialPickDetailSheet.tsx');
const matPage = src('app/material/[id].tsx');
for (const [name, body] of [['list', mats], ['sheet', matSheet], ['page', matPage]] as const) {
  if (!body.includes("title: 'Согласовать материал?'")) throw new Error(`material approve ${name}`);
}
if (!matSheet.includes("title: 'Убрать закупку из факта?'")) throw new Error('purchase rollback confirm');
if (!matSheet.includes('primaryDestructive: true') || !matSheet.includes('variant="dangerOutline"')) {
  throw new Error('purchase rollback destructive hierarchy');
}
if (!matSheet.includes('api.updatePurchaseStatus') || !matSheet.includes("loading={busyAction === 'rollback'}")) {
  throw new Error('purchase rollback canonical mutation/loading');
}

const pay = src('components/renova/PaymentDetailSheet.tsx');
if (!pay.includes("title: 'Подтвердить оплату?'")) throw new Error('payment confirm');

const viewers = src('components/renova/ViewerSharePanel.tsx');
if (!viewers.includes("title: 'Удалить гостя?'")) throw new Error('viewer remove confirm');
if (!viewers.includes('primaryDestructive: true')) throw new Error('viewer remove destructive confirm');
if (!viewers.includes('const busyRef = useRef(false)')) throw new Error('viewer duplicate mutation guard');
if (!viewers.includes('width: RenovaTheme.minTouch')) throw new Error('viewer actions min touch');
if (!viewers.includes("loading={busyAction === 'add'}")) throw new Error('viewer add loading state');
if (!viewers.includes('disabled={busy}')) throw new Error('viewer actions disabled while busy');

const budgetSummary = src('components/screens/budget/BudgetSummarySection.tsx');
const budgetScreen = src('components/screens/OsBudgetScreen.tsx');
const budgetStyles = src('components/screens/budget/budgetScreenStyles.ts');
if (!budgetSummary.includes('buildBudgetSummaryView') || !budgetSummary.includes('Состояние бюджета')) {
  throw new Error('budget decision summary missing');
}
if (!budgetSummary.includes('nextAction.title') || !budgetSummary.includes("title: 'Разобрать отклонения'")) {
  throw new Error('budget next action missing');
}
if (budgetSummary.includes('summaryWidgets') || budgetScreen.includes('const summaryWidgets')) {
  throw new Error('budget duplicate summary widgets remain');
}
if (!budgetStyles.includes('summaryHero') || !budgetStyles.includes('summaryMetaRow')) {
  throw new Error('budget summary shared surface styles');
}

const overBudget = buildBudgetSummaryView({ planned: 1000, spent: 1200, forecast: 1300, pendingAmounts: [100, 200] });
if (overBudget.state !== 'over' || overBudget.deviation !== 200 || overBudget.pendingAmount !== 300 || overBudget.pendingCount !== 2) {
  throw new Error('budget overrun decision model');
}
const forecastRisk = buildBudgetSummaryView({ planned: 1000, spent: 700, forecast: 1100 });
if (forecastRisk.state !== 'forecast-risk' || forecastRisk.remaining !== 300) {
  throw new Error('budget forecast risk model');
}
const onTrack = buildBudgetSummaryView({ planned: 1000, spent: 700, forecast: 900, customerBudget: 650 });
if (onTrack.state !== 'on-track' || onTrack.customerBudgetOver !== 50 || onTrack.margin !== 300) {
  throw new Error('budget on-track/limit model');
}
const emptyBudget = buildBudgetSummaryView({ planned: Number.NaN, spent: Number.NaN, pendingAmounts: [-1, Number.NaN] });
if (emptyBudget.state !== 'empty' || emptyBudget.pendingAmount !== 0 || emptyBudget.customerBudget !== null) {
  throw new Error('budget invalid input normalization');
}

const expenseSection = src('components/screens/budget/BudgetExpensesSection.tsx');
const manualExpense = src('components/renova/ManualExpenseForm.tsx');
const expensePickers = src('components/renova/ExpenseContextPickers.tsx');
const formStyles = src('constants/formStyles.ts');
if (expenseSection.indexOf('<UnifiedExpenseList') > expenseSection.indexOf('<ReceiptBulkLinkPanel')) {
  throw new Error('expense list must precede bulk tools');
}
if (!expenseSection.includes("filter === 'no-stage'") || !expenseSection.includes('<ReceiptBulkLinkPanel')) {
  throw new Error('bulk link only in no-stage context');
}
if (!expenseSection.includes('collapsed') || !expenseSection.includes('Показать все траты')) {
  throw new Error('expense progressive disclosure/recovery');
}
if (!manualExpense.includes('const busyRef = useRef(false)') || !manualExpense.includes('if (busyRef.current || readOnly) return')) {
  throw new Error('manual expense duplicate submit guard');
}
if (!manualExpense.includes('loading={busy}') || !manualExpense.includes('title="Добавить расход"')) {
  throw new Error('manual expense primary loading action');
}
if (!manualExpense.includes('Введённые данные сохранены в форме') || !formStyles.includes('minHeight: RenovaTheme.minTouch')) {
  throw new Error('manual expense draft/touch contract');
}
if (!manualExpense.includes('let saved = false') || !manualExpense.includes('void syncProjectSideEffects')) {
  throw new Error('manual expense durable write contract');
}
if (!expensePickers.includes('filterChipStyles') || expensePickers.includes('backgroundColor: RenovaTheme.colors.primary')) {
  throw new Error('expense categories not on shared chips');
}
if (!expensePickers.includes('accessibilityState={{ selected, disabled: Boolean(disabled) }}')) {
  throw new Error('expense category accessibility state');
}

const typography = src('constants/screenTypography.ts');
if (!typography.includes('export const filterChipStyles')) throw new Error('filterChipStyles SoT');

const scheduleChips = src('components/renova/schedule/ScheduleFilterChips.tsx');
if (!scheduleChips.includes('filterChipStyles') || scheduleChips.includes('accent')) {
  throw new Error('ScheduleFilterChips not on SoT');
}

const estimateBar = src('components/renova/estimate/EstimateFilterBar.tsx');
if (!estimateBar.includes('filterChipStyles')) throw new Error('EstimateFilterBar chips');

const search = src('components/renova/SearchFilter.tsx');
if (!search.includes('filterChipStyles') || search.includes('colors.primary }')) {
  throw new Error('SearchFilter chips');
}

const dashboard = src('components/screens/ManagerDashboardScreen.tsx');
if (!dashboard.includes('listRowStyles.metricCell') || dashboard.includes('...card')) {
  throw new Error('ManagerDashboard still Theme.card');
}

const breakdown = src('components/renova/BudgetBreakdown.tsx');
if (!breakdown.includes('screenTypography') || breakdown.includes("fontWeight:'800'") || breakdown.includes("fontWeight: '800'")) {
  throw new Error('BudgetBreakdown SoT');
}

console.log('clarityWaveV.w175.test OK');
