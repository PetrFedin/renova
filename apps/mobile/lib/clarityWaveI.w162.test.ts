/** Clarity I: Documents digest + receiptNav + payment gate sheets */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const docs = readFileSync(join(mobile, 'components/renova/DocumentsHub.tsx'), 'utf8');
const receipt = readFileSync(join(mobile, 'lib/receiptNav.ts'), 'utf8');
const pay = readFileSync(join(mobile, 'components/renova/PaymentDetailSheet.tsx'), 'utf8');
const work = readFileSync(join(mobile, 'components/renova/CreateWorkSheet.tsx'), 'utf8');

console.assert(docs.includes('showActionConfirm') && docs.includes('Дайджест отправлен'), 'docs digest sheet');
console.assert(docs.includes('Не удалось открыть') && docs.includes('showActionConfirm'), 'docs open fail CTA');
console.assert(receipt.includes('showActionConfirm') && !receipt.includes('Alert.alert'), 'receiptNav sheet');
console.assert(pay.includes('confirmAcceptanceFirst') && pay.includes('showActionConfirm'), 'payment gate sheet');
console.assert(pay.includes("title: 'Оплата (demo)'"), 'payment demo honesty sheet');
console.assert(work.includes('notifyOfflineQueued'), 'create work offline sheet');

const ok =
  docs.includes('Дайджест отправлен') &&
  !receipt.includes('Alert.alert') &&
  pay.includes('confirmAcceptanceFirst');
if (!ok) process.exit(1);
console.log('clarityWaveI.w162.test OK');
