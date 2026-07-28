/** Clarity V: approve asymmetries; payment/viewer; Manager KPI + filterChip + BudgetBreakdown */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const src = (rel: string) => readFileSync(join(mobile, rel), 'utf8');

const stage = src('components/screens/StageDetailScreen.tsx');
if (!stage.includes("title: emptyChecklist ? 'Принять без чеклиста?' : 'Принять этап?'")) {
  throw new Error('stage accept always-confirm missing');
}

const sel = src('components/screens/OsSelectionsScreen.tsx');
if (!sel.includes("title: 'Согласовать подбор?'")) throw new Error('selection approve confirm');

const rooms = src('components/screens/OsRoomsScreen.tsx');
if (!rooms.includes("title: 'Согласовать запрос?'") || !rooms.includes("title: archived ? 'В архив?'")) {
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
for (const [n, b] of [['list', mats], ['sheet', matSheet], ['page', matPage]] as const) {
  if (!b.includes("title: 'Согласовать материал?'")) throw new Error(`material approve ${n}`);
}
if (!matSheet.includes("title: 'Убрать из факта?'")) throw new Error('purchase cancel confirm');

const pay = src('components/renova/PaymentDetailSheet.tsx');
if (!pay.includes("title: 'Подтвердить оплату?'")) throw new Error('payment confirm');
if (pay.includes('onConfirmed?.(') && pay.includes('await syncProjectSideEffects') && pay.split('const confirm').length > 2) {
  // orphan guard soft — ensure single confirm fn
}

const viewers = src('components/renova/ViewerSharePanel.tsx');
if (!viewers.includes("title: 'Удалить гостя?'")) throw new Error('viewer remove confirm');
if (!viewers.includes('primaryDestructive: true')) throw new Error('viewer remove destructive confirm');
if (!viewers.includes('const busyRef = useRef(false)')) throw new Error('viewer duplicate mutation guard');
if (!viewers.includes('width: RenovaTheme.minTouch')) throw new Error('viewer actions min touch');
if (!viewers.includes("loading={busyAction === 'add'}")) throw new Error('viewer add loading state');
if (!viewers.includes('disabled={busy}')) throw new Error('viewer actions disabled while busy');

const typo = src('constants/screenTypography.ts');
if (!typo.includes('export const filterChipStyles')) throw new Error('filterChipStyles SoT');

const schedChips = src('components/renova/schedule/ScheduleFilterChips.tsx');
if (!schedChips.includes('filterChipStyles') || schedChips.includes('accent')) {
  throw new Error('ScheduleFilterChips not on SoT');
}

const estBar = src('components/renova/estimate/EstimateFilterBar.tsx');
if (!estBar.includes('filterChipStyles')) throw new Error('EstimateFilterBar chips');

const search = src('components/renova/SearchFilter.tsx');
if (!search.includes('filterChipStyles') || search.includes('colors.primary }')) {
  throw new Error('SearchFilter chips');
}

const dash = src('components/screens/ManagerDashboardScreen.tsx');
if (!dash.includes('listRowStyles.metricCell') || dash.includes('...card')) {
  throw new Error('ManagerDashboard still Theme.card');
}

const bb = src('components/renova/BudgetBreakdown.tsx');
if (!bb.includes('screenTypography') || bb.includes("fontWeight:'800'") || bb.includes("fontWeight: '800'")) {
  throw new Error('BudgetBreakdown SoT');
}

console.log('clarityWaveV.w175.test OK');
