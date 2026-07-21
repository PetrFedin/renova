/** W136: room change/archive, waste, expense edit, estimate revoke → SoT */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');

const nav = readFileSync(join(mobile, 'lib/siteOpsNav.ts'), 'utf8');
const pay = readFileSync(join(mobile, 'lib/estimatePayNav.ts'), 'utf8');
const rooms = readFileSync(join(mobile, 'components/screens/OsRoomsScreen.tsx'), 'utf8');
const waste = readFileSync(join(mobile, 'components/renova/WasteOrderList.tsx'), 'utf8');
const expense = readFileSync(join(mobile, 'components/renova/ExpenseDetailSheet.tsx'), 'utf8');
const est = readFileSync(join(mobile, 'components/screens/estimate/ContractorEstimateView.tsx'), 'utf8');

console.assert(nav.includes('alertRoomChangeRequested') && nav.includes('alertRoomArchived'), 'rooms');
console.assert(nav.includes('alertWasteOrderAdvanced') && nav.includes('alertExpenseUpdated'), 'waste+expense');
console.assert(pay.includes('alertEstimateProposalRevoked'), 'revoke');
console.assert(rooms.includes('alertRoomChangeRequested') && rooms.includes('alertApprovalApproved'), 'rooms wired');
console.assert(rooms.includes('alertRoomArchived') && rooms.includes('alertApprovalRejected'), 'archive+reject');
console.assert(waste.includes('alertWasteOrderAdvanced'), 'waste wired');
console.assert(expense.includes('alertExpenseUpdated') && expense.includes('alertExpenseDeleted'), 'expense');
console.assert(est.includes('alertEstimateProposalRevoked'), 'estimate revoke');
console.assert(!rooms.includes("Alert.alert('В архиве'"), 'archive shared');

console.log('journeyUnify.w136.test.ts OK');
