/** Волна 1-B: выход из paid_unverified, отмена/правка счёта, статусы processing — контракт UI и API-клиента. */
import { readFileSync } from 'fs';
import { join } from 'path';

const repo = join(__dirname, '../../..');
const svc = readFileSync(join(repo, 'backend/app/services/payment_service.py'), 'utf8');
const api = readFileSync(join(repo, 'backend/app/api/v1/payments.py'), 'utf8');
const sheet = readFileSync(join(__dirname, '../components/renova/PaymentDetailSheet.tsx'), 'utf8');
const section = readFileSync(join(__dirname, '../components/screens/budget/BudgetPaymentsSection.tsx'), 'utf8');
const stageBlock = readFileSync(join(__dirname, '../components/screens/stage/StageDetailPaymentBlock.tsx'), 'utf8');
const client = readFileSync(join(__dirname, 'api/payments.ts'), 'utf8');
const labels = readFileSync(join(__dirname, '../constants/labels.ts'), 'utf8');

function must(c: boolean, m: string) { if (!c) throw new Error(m); }

// backend: чек подтверждает счёт только при покрытии суммы
must(svc.includes('settlement_receipt_id') && svc.includes('RECEIPT_COVERAGE_TOLERANCE = 1.0'), 'receipt must cover invoice amount');
must(api.includes('recipient-response') && api.includes('/cancel'), 'recipient and cancel endpoints exist');

// клиент API
must(client.includes('cancelPayment') && client.includes('respondPaymentReceived') && client.includes('updatePayment'), 'api client covers new transitions');
must(client.includes('/recipient-response') && client.includes("method: 'PATCH'"), 'client routes match backend');

// карточка счёта
must(sheet.includes('Деньги получены') && sheet.includes('Не получены'), 'contractor can answer for paid_unverified');
must(sheet.includes('Приложить чек') && sheet.includes("payment.status === 'paid_unverified'"), 'customer can attach receipt after paid_unverified');
must(sheet.includes('Отозвать счёт') && sheet.includes('Отклонить счёт') && sheet.includes('Исправить сумму'), 'pending invoice can be cancelled/rejected/edited');
must(sheet.includes("payment.status === 'processing'") && sheet.includes('Продолжить оплату картой') && sheet.includes('Проверить статус'), 'processing has actions');
must(sheet.includes('isAcceptanceConflict'), '409 is not always read as acceptance gate');
must(!/const openReceipt = \(\) => \{\s*if \(mutationRef\.current\) return;\s*setReceiptAttached\(true\)/.test(sheet), 'receipt flag is set only after a successful scan');

// подписи и списки
for (const status of ['processing', 'disputed', 'cancelled', 'refunded']) {
  must(labels.includes(`${status}: '`), `label for ${status}`);
}
must(section.includes('Заказчик отметил перевод — подтвердите'), 'row hints tell contractor what to do');
must(stageBlock.includes("p.status !== 'cancelled'") && stageBlock.includes('stagePayments.map'), 'stage block lists all live stage invoices');

console.log('paymentLifecycle.wave1.test.ts OK');
