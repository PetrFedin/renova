/** Clarity L: silent-empty → LoadError; offline/post-success sheets; list-row leftovers */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const src = (rel: string) => readFileSync(join(mobile, rel), 'utf8');

const chat = src('components/renova/chat/ChatListView.tsx');
const wo = src('components/renova/WorkOrdersListPanel.tsx');
const activity = src('components/renova/ActivityFeed.tsx');
const week = src('components/renova/os/WeekScheduleStrip.tsx');
const manual = src('components/renova/ManualExpenseForm.tsx');
const day = src('components/renova/schedule/ScheduleDayDetail.tsx');
const cust = src('components/screens/control/CustomerControlView.tsx');
const contr = src('components/screens/control/ContractorControlView.tsx');
const stage = src('components/screens/StageDetailScreen.tsx');
const works = src('components/screens/OsWorksScreen.tsx');
const purchase = src('components/renova/PurchaseList.tsx');
const picks = src('components/renova/MaterialPickList.tsx');
const expenses = src('components/renova/UnifiedExpenseList.tsx');

if (!chat.includes('LoadErrorState') || !chat.includes('loadError')) throw new Error('chat loadError');
if (!wo.includes('LoadErrorState') || !wo.includes('loadError')) throw new Error('workOrders loadError');
if (!activity.includes('LoadErrorState') || !activity.includes('loadError')) throw new Error('activity loadError');
if (!week.includes('LoadErrorState') || !week.includes('loadError')) throw new Error('week loadError');
if (!manual.includes('notifyOfflineQueued') || !manual.includes('isOfflineQueued')) throw new Error('manual expense offline');
if (!day.includes('showActionConfirm') || day.includes("Alert.alert('Срок обновлён'")) throw new Error('day extend sheet');
if (!cust.includes('showActionConfirm') || !contr.includes('showActionConfirm')) throw new Error('control QC sheets');
if (!stage.includes('Нужен доступ к фото')) throw new Error('stage photo permission');
if (!works.includes('EmptyActionState')) throw new Error('works empty CTA');
if (!purchase.includes('listRowStyles') || purchase.includes('...card')) throw new Error('purchase list-row');
if (!picks.includes('listRowStyles')) throw new Error('picks list-row');
if (!expenses.includes('listRowStyles')) throw new Error('expenses list-row');

console.log('clarityWaveL.w165.test OK');
