/** W143: transfer_ack alone → paid_unverified (не budget fact) */
import { readFileSync } from 'fs';
import { join } from 'path';

const repo = join(__dirname, '../../..'); // apps/mobile/lib → renova
const svc = readFileSync(join(repo, 'backend/app/services/payment_service.py'), 'utf8');
const sheet = readFileSync(join(__dirname, '../components/renova/PaymentDetailSheet.tsx'), 'utf8');

function must(c: boolean, m: string) { if (!c) throw new Error(m); }
must(svc.includes('PaymentStatus.paid_unverified'), 'SM has paid_unverified');
must(svc.includes('ack_without_receipt'), 'ack path logged');
must(svc.includes('unverified_only'), 'unverified branch');
must(sheet.includes('paid_unverified'), 'sheet handles unverified');
must(sheet.includes('Принято без проверки'), 'honesty alert');
console.log('paymentUnverified.w143.test OK');
