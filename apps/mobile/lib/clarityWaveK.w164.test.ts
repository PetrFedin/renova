/** Clarity K: visual density — sentence-case sections, list-row вместо card-стеков */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');

function src(rel: string) {
  return readFileSync(join(mobile, rel), 'utf8');
}

const objectSection = src('components/screens/object/ObjectSection.tsx');
const objectProfile = src('components/screens/object/ObjectProfileSection.tsx');
const profileSection = src('components/screens/profile/ProfileSection.tsx');
const inbox = src('components/screens/UnifiedInboxScreen.tsx');
const rooms = src('components/screens/OsRoomsScreen.tsx');
const materials = src('components/screens/OsMaterialsScreen.tsx');
const qc = src('components/screens/QualityControlScreen.tsx');
const osPanels = src('components/renova/os/ProjectOsPanels.tsx');
const deps = src('components/renova/StageDependenciesPanel.tsx');
const woScreen = src('components/screens/WorkOrderDetailScreen.tsx');
const woPanel = src('components/renova/WorkOrderDetailPanel.tsx');
const chatList = src('components/renova/chat/ChatListView.tsx');
const woCard = src('components/renova/WorkOrderCard.tsx');
const dayDetail = src('components/renova/schedule/ScheduleDayDetail.tsx');
const estimateSum = src('components/screens/estimate/EstimateSummaryLayer.tsx');
const budget = src('components/renova/BudgetPlannerPanel.tsx');
const docs = src('components/renova/DocumentsHub.tsx');
const customerProfile = src('components/screens/profile/CustomerProfileScreen.tsx');
const contractorProfile = src('components/screens/profile/ContractorProfileScreen.tsx');

for (const [name, body] of [
  ['ObjectSection', objectSection],
  ['ObjectProfileSection', objectProfile],
  ['ProfileSection', profileSection],
  ['UnifiedInbox', inbox],
  ['OsRooms', rooms],
  ['OsMaterials', materials],
  ['QualityControl', qc],
  ['ProjectOsPanels', osPanels],
  ['StageDependencies', deps],
  ['WorkOrderDetailScreen', woScreen],
  ['WorkOrderDetailPanel', woPanel],
  ['ChatListView', chatList],
  ['WorkOrderCard', woCard],
  ['ScheduleDayDetail', dayDetail],
  ['EstimateSummary', estimateSum],
  ['BudgetPlanner', budget],
] as const) {
  if (!body.includes('screenTypography') && !body.includes('listRowStyles')) {
    throw new Error(`${name}: missing screenTypography/listRowStyles`);
  }
  if (body.includes("textTransform: 'uppercase'")) {
    throw new Error(`${name}: still uppercase`);
  }
}

// Shared sections: no card import / no uppercase cry
if (objectSection.includes('from \'@/constants/Theme\'') && objectSection.includes(', card')) {
  throw new Error('ObjectSection: still imports card');
}
if (!inbox.includes('listRowStyles')) throw new Error('inbox list rows');
if (!qc.includes('listRowStyles')) throw new Error('qc list rows');
if (!osPanels.includes('listRowStyles.row')) throw new Error('os panels list rows');
if (!chatList.includes('listRowStyles')) throw new Error('chat list rows');

// Functional: Excel menu → sheet; profile «Ещё» → «Дополнительно»
if (!docs.includes("title: 'Смета для Excel'") || !docs.includes('showActionConfirm')) {
  throw new Error('docs estimate menu not on sheet');
}
if (docs.includes("Alert.alert('Смета для Excel'")) {
  throw new Error('docs still Alert for Excel menu');
}
if (customerProfile.includes('title="Ещё"') || contractorProfile.includes('title="Ещё"')) {
  throw new Error('profile still Ещё');
}
if (!customerProfile.includes('title="Дополнительно"') || !contractorProfile.includes('title="Дополнительно"')) {
  throw new Error('profile missing Дополнительно');
}

if (!qc.includes('EmptyActionState') || !qc.includes('На главную')) {
  throw new Error('qc empty project CTA');
}
const mgr = src('components/screens/ManagerDashboardScreen.tsx');
if (!mgr.includes('EmptyActionState') || !mgr.includes('На главную')) {
  throw new Error('manager empty project CTA');
}
const hubTabs = src('components/renova/os/OsHubTabs.tsx');
if (!hubTabs.includes('>Все</Text>')) throw new Error('hub overflow should be Все');
if (hubTabs.includes('Ещё вкладки') || hubTabs.includes('>Ещё</Text>')) {
  throw new Error('hub still Ещё overflow');
}

if (!qc.includes('LoadErrorState') || !qc.includes('loadError')) {
  throw new Error('qc load error UI');
}
const roomDetail = src('components/screens/RoomDetailScreen.tsx');
if (
  !roomDetail.includes("'Архивирование комнаты'")
  || !roomDetail.includes("'Восстановление комнаты'")
) {
  throw new Error('room archive and restore offline notices');
}
const dock = src('constants/dockBar.ts');
if (!dock.includes("label: 'Профиль'") || dock.includes("label: 'Ещё'")) {
  throw new Error('dock more → Профиль');
}
if (!inbox.includes('EmptyActionState')) throw new Error('inbox empty CTA');

console.log('clarityWaveK.w164.test OK');
