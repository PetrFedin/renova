/** W143: transfer_ack alone → paid_unverified (не budget fact) + financial truth guards */
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

must(
  sheet.includes("reportError('payment.requisites.load'")
    && sheet.includes('Не удалось подтвердить реквизиты на сервере. Не переводите средства до повторной проверки.')
    && sheet.includes('canUseRequisites'),
  'bank transfer must fail closed when server requisites cannot be verified',
);
must(
  !sheet.includes('const requisites = reqText ||')
    && !sheet.includes('setReqText(buildPaymentRequisites({ amount: payment.amount'),
  'requisites outage must not silently fabricate authoritative local transfer details',
);
must(
  sheet.includes("checkout.status === 'demo'")
    && sheet.includes("checkout.provider === 'mock'")
    && sheet.includes("reportError('payment.checkout.mockProvider'")
    && sheet.includes('Реальное списание не выполняется.'),
  'mock/demo checkout must be rejected as unavailable instead of presented as payment success',
);
must(!sheet.includes("title: 'Оплата (demo)'"), 'production payment sheet must not expose demo success UX');
must(!sheet.includes('as never'), 'payment side effects must never fabricate user/project context');
must(
  sheet.includes("reportError('payment.postCommit.context'")
    && sheet.includes("reportError('payment.postCommit.sync'")
    && sheet.includes('const project = activeProject?.id === projectId')
    && sheet.includes('await api.getProject(userId, projectId);'),
  'post-commit payment reconciliation must use real user/project context and remain observable',
);

const confirmMutation = sheet.indexOf('confirmed = await api.confirmPayment');
const confirmReconcile = sheet.indexOf("await reconcileCommittedPayment('confirm')", confirmMutation);
const confirmPartial = sheet.indexOf("title: 'Оплата сохранена'", confirmReconcile);
must(
  confirmMutation >= 0 && confirmReconcile > confirmMutation && confirmPartial > confirmReconcile,
  'confirmed payment mutation must be separated from post-commit reconciliation and partial-success UX',
);
const disputeMutation = sheet.indexOf('await api.disputePayment');
const disputeReconcile = sheet.indexOf("await reconcileCommittedPayment('dispute')", disputeMutation);
must(disputeMutation >= 0 && disputeReconcile > disputeMutation, 'dispute mutation truth must precede reconciliation');
const resolveMutation = sheet.indexOf('result = await api.resolvePaymentDispute');
const resolveReconcile = sheet.indexOf("await reconcileCommittedPayment('resolve_dispute')", resolveMutation);
must(resolveMutation >= 0 && resolveReconcile > resolveMutation, 'dispute resolution truth must precede reconciliation');

console.log('paymentUnverified.w143.test OK');
