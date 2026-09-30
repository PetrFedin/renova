import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// EST-008 / CMP-013: формы разбирают пользовательские числа только через parseLocaleNumber.
const root = join(__dirname, '..');
const forms = [
  'components/renova/CreateRoomSheet.tsx',
  'components/renova/room/RoomSetupFields.tsx',
  'components/renova/CreatePaymentForm.tsx',
  'components/renova/ManualExpenseForm.tsx',
  'components/renova/ExpenseDetailSheet.tsx',
  'components/renova/AddEstimateLineForm.tsx',
  'components/renova/MaterialPickList.tsx',
  'components/renova/CreateWorkSheet.tsx',
  'components/renova/CustomerBudgetField.tsx',
  'components/renova/estimate/EstimateLineEditorCard.tsx',
  'components/screens/estimate/ContractorEstimateView.tsx',
  'components/screens/OsSelectionsScreen.tsx',
  'app/material/[id].tsx',
  'app/wizard/_screens/rooms.tsx',
  'app/wizard/_screens/confirm.tsx',
  'app/wizard/_screens/type.tsx',
];
for (const rel of forms) {
  const src = readFileSync(join(root, rel), 'utf8');
  if (!src.includes("@/lib/parseLocaleNumber")) throw new Error(`${rel}: parseLocaleNumber не подключён`);
  if (/\bparseFloat\(|Number\.parseFloat\(/.test(src)) throw new Error(`${rel}: остался parseFloat`);
  if (/(?<![A-Za-z.])Number\((amount|price|budget|allowance|manualPrice|amountText)[A-Za-z]*(\.replace[^)]*\))?\)/.test(src)) {
    throw new Error(`${rel}: остался Number(<поле ввода>)`);
  }
}
// допсоглашение / платёж / расход: сумма > 0 обязательна
const co = readFileSync(join(root, 'components/screens/estimate/ContractorEstimateView.tsx'), 'utf8');
if (!co.includes('parsePositiveNumber(coAmount)')) throw new Error('допсоглашение без проверки суммы > 0');
console.log('parseLocaleNumberWired.test OK');
