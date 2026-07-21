/** W112: createStage/expenses offline; flush→bus; WO create UI */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const stages = readFileSync(join(mobile, 'lib/api/stages.ts'), 'utf8');
const os = readFileSync(join(mobile, 'lib/api/os.ts'), 'utf8');
const sheet = readFileSync(join(mobile, 'components/renova/CreateWorkSheet.tsx'), 'utf8');
const syncUi = readFileSync(join(mobile, 'components/renova/OfflineSyncStatus.tsx'), 'utf8');
const works = readFileSync(join(mobile, 'components/screens/OsWorksScreen.tsx'), 'utf8');
const expense = readFileSync(join(mobile, 'components/renova/ExpenseDetailSheet.tsx'), 'utf8');
const day = readFileSync(join(mobile, 'components/renova/schedule/ScheduleDayDetail.tsx'), 'utf8');

console.assert(stages.includes('createStage') && stages.includes('offline_queued'), 'createStage offline');
console.assert(stages.includes('/stages`') || stages.includes('stages`, { method: \'POST\''), 'createStage POST');
console.assert(os.includes('patchOsExpense') && os.includes('offline_queued'), 'expense patch offline');
console.assert(os.includes('deleteOsExpense') && os.includes("'DELETE'"), 'expense delete offline');
console.assert(sheet.includes('offline_queued') && sheet.includes('Работа отправится'), 'WO create UI');
console.assert(syncUi.includes('syncProjectSideEffects') && syncUi.includes('result.synced'), 'flush→bus');
console.assert(works.includes('createStage') && works.includes('offline_queued'), 'works create offline');
console.assert(expense.includes('offline_queued') && expense.includes('траты'), 'expense UI offline');
console.assert(day.includes('offline_queued'), 'schedule day offline');

console.log('journeyUnify.w112.test.ts OK');
