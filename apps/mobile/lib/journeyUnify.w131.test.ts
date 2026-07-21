/** W131: estimate lock / payment / chat invoice·task → SoT CTAs */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');

const nav = readFileSync(join(mobile, 'lib/estimatePayNav.ts'), 'utf8');
const cust = readFileSync(join(mobile, 'components/screens/estimate/CustomerEstimateView.tsx'), 'utf8');
const contr = readFileSync(join(mobile, 'components/screens/estimate/ContractorEstimateView.tsx'), 'utf8');
const pay = readFileSync(join(mobile, 'components/renova/PaymentDetailSheet.tsx'), 'utf8');
const chat = readFileSync(join(mobile, 'components/renova/chat/ChatThreadView.tsx'), 'utf8');

console.assert(nav.includes('alertEstimateLocked') && nav.includes("'/documents'"), 'lock→docs');
console.assert(nav.includes('alertEstimateProposed') && nav.includes("'/inbox'"), 'propose→inbox');
console.assert(nav.includes('alertPaymentConfirmed') && nav.includes('alertChatInvoiceCreated'), 'pay+invoice');
console.assert(nav.includes('alertChatTaskCreated') && nav.includes('calendarTabRoute'), 'task→calendar');
console.assert(cust.includes('alertEstimateLocked') && cust.includes('alertEstimateLockRejected'), 'customer estimate');
console.assert(contr.includes('alertEstimateProposed'), 'contractor propose');
console.assert(pay.includes('alertPaymentConfirmed'), 'payment confirm');
console.assert(chat.includes('alertChatInvoiceCreated') && chat.includes('alertChatTaskCreated'), 'chat wired');
console.assert(!chat.includes("budgetTabRoute('contractor', 'payments')"), 'invoice role not hardcoded');

console.log('journeyUnify.w131.test.ts OK');
