/** W123: bank statement → confirm payments → budget SoT (Smetter/Gectaro) */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');

const sheet = readFileSync(join(mobile, 'components/renova/BankStatementImportSheet.tsx'), 'utf8');
const docs = readFileSync(join(mobile, 'components/renova/DocumentsHub.tsx'), 'utf8');
const paySec = readFileSync(join(mobile, 'components/screens/budget/BudgetPaymentsSection.tsx'), 'utf8');
const detail = readFileSync(join(mobile, 'components/renova/PaymentDetailSheet.tsx'), 'utf8');

console.assert(sheet.includes('confirmBankStatementMatches') && sheet.includes('syncProjectSideEffects'), 'sheet confirm+bus');
console.assert(sheet.includes("budgetTabRoute(role, 'payments')") && sheet.includes('К оплатам'), 'sheet→payments SoT');
console.assert(sheet.includes("budgetTabRoute(role, 'expenses')"), 'sheet→expenses SoT');
console.assert(docs.includes('BankStatementImportSheet') && !docs.includes('submitBankImport'), 'docs uses sheet');
console.assert(paySec.includes('BankStatementImportSheet') && paySec.includes('Импорт выписки банка'), 'budget payments entry');
console.assert(detail.includes('Импорт выписки (пакетно)') && detail.includes("pushOsNav('/documents'"), 'payment detail→docs');

console.log('journeyUnify.w123.test.ts OK');
