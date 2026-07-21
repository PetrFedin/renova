/** W129: receipt scan/reverify/manual → budget/materials/payments SoT (ФНС RU) */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');

const nav = readFileSync(join(mobile, 'lib/receiptNav.ts'), 'utf8');
const scan = readFileSync(join(mobile, 'app/scan-receipt.tsx'), 'utf8');
const list = readFileSync(join(mobile, 'components/renova/ReceiptList.tsx'), 'utf8');
const manual = readFileSync(join(mobile, 'components/renova/ManualExpenseForm.tsx'), 'utf8');
const recon = readFileSync(join(mobile, 'components/renova/MaterialReceiptReconcile.tsx'), 'utf8');

console.assert(nav.includes('alertReceiptScanned') && nav.includes("budgetTabRoute(role, 'expenses')"), 'scan→expenses');
console.assert(nav.includes('alertReceiptReverified') && nav.includes('alertManualExpenseSaved'), 'reverify+manual');
console.assert(nav.includes("budgetTabRoute(role, 'payments')"), 'scan→payments if linked');
console.assert(scan.includes('alertReceiptScanned') && scan.includes('syncProjectSideEffects'), 'scan wired');
console.assert(list.includes('alertReceiptReverified'), 'list reverify');
console.assert(manual.includes('alertManualExpenseSaved'), 'manual expense');
console.assert(recon.includes("pushOsNav('/scan-receipt'") && recon.includes('Сканировать чек'), 'reconcile CTA');

console.log('journeyUnify.w129.test.ts OK');
