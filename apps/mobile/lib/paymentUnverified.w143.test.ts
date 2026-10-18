/** W143: paid_unverified stays non-financial until reviewed PaymentEvidence + mobile recovery truth */
import { readFileSync } from 'fs';
import { join } from 'path';
import { SETTLEMENT_HINTS, contractorSettlementDetail } from './domain/paymentSettlementCopy';

const repo = join(__dirname, '../../..');
const svc = readFileSync(join(repo, 'backend/app/services/payment_service.py'), 'utf8');
const evidenceSvc = readFileSync(join(repo, 'backend/app/services/payment_evidence_service.py'), 'utf8');
const evidenceApi = readFileSync(join(repo, 'backend/app/api/v1/payment_evidence.py'), 'utf8');
const sheet = readFileSync(join(__dirname, '../components/renova/PaymentDetailSheet.tsx'), 'utf8');
const evidenceSheet = readFileSync(join(__dirname, '../components/renova/PaymentEvidenceSheet.tsx'), 'utf8');
const paymentsSection = readFileSync(join(__dirname, '../components/screens/budget/BudgetPaymentsSection.tsx'), 'utf8');
const paymentsApi = readFileSync(join(__dirname, 'api/payments.ts'), 'utf8');

function must(c: boolean, m: string) { if (!c) throw new Error(m); }
must(svc.includes('PaymentStatus.paid_unverified'), 'SM has paid_unverified');
must(svc.includes('ack_without_receipt'), 'ack path logged');
must(svc.includes('unverified_only'), 'unverified branch');
must(svc.includes('reviewed_evidence_id'), 'reviewed evidence enters canonical confirmation');
must(sheet.includes('paid_unverified'), 'sheet handles unverified');
must(sheet.includes('Принято без проверки'), 'honesty alert');
must(evidenceSvc.includes('latest_row.status != "rejected"'), 'resubmit allowed only after rejection');
must(evidenceSvc.includes('version = int(latest or 0) + 1'), 'resubmit creates a new immutable version');

must(evidenceSheet.includes("type: ['image/jpeg', 'image/png', 'application/pdf']"), 'evidence picker is bounded to JPEG/PNG/PDF');
must(evidenceSheet.includes("latest?.status === 'rejected'") && evidenceSheet.includes("'Загрузить новую версию'"), 'rejected evidence exposes resubmit action');
must(evidenceSheet.includes('row.rejection_reason'), 'rejection reason is visible');
must(evidenceSheet.includes("row.status === 'submitted'"), 'submitted/pending-review truth is visible');
must(evidenceSheet.includes("payment.status === 'pending' || payment.status === 'paid_unverified'"), 'manual proof may start directly from an eligible pending payment');
must(evidenceSheet.includes('После отправки файла перевод получает статус') && evidenceSheet.includes('подтверждённый расход'), 'pending evidence explains the server truth transition without false success');
must(evidenceSheet.includes('intentRequestId') && evidenceSheet.includes('submitRequestId'), 'stable identities are retained for retry');
must(evidenceSheet.includes('resumePaymentEvidenceUpload') && evidenceSheet.includes("latest?.status === 'upload_pending'"), 'upload_pending can recover after reopening instead of creating a second intent');
must(evidenceSheet.includes('продолжит тот же запрос') && evidenceSheet.includes('не создаст дубликат'), 'ambiguous upload tells user to retry the same logical request');
must(evidenceSheet.includes("reportError('payment.evidence.upload'"), 'upload failure is observable');
must(paymentsApi.includes("reportError('payment.evidence.uploadResponse.parse'"), 'upload response parse failures are observable');
must(paymentsApi.includes('existingEvidenceUploadTarget') && paymentsApi.includes('external_presigned: false'), 'mobile recovery stays on authenticated API upload target');
must(evidenceApi.includes('"external_presigned": False') && !evidenceApi.includes('storage_service.presigned_put'), 'financial evidence has no reusable direct S3 PUT');
must(evidenceSheet.includes('RenovaTheme.spacing.md') && evidenceSheet.includes('RenovaTheme.fontSize.body'), 'evidence UI uses canonical design tokens');
must(!evidenceSheet.includes('request identity'), 'customer copy must not expose internal idempotency jargon');
must(!evidenceSheet.includes('Оплата подтверждена'), 'evidence sheet must not claim confirmation before server payment truth refresh');

must(paymentsSection.includes("'Я перевёл — приложить подтверждение'"), 'pending payment exposes one direct proof CTA after the real transfer');
must(paymentsSection.includes("payment.status === 'pending' || payment.status === 'paid_unverified'"), 'proof CTA covers pending and already-unverified manual payments');
must(paymentsSection.includes('stage?.customer_accepted_at') && paymentsSection.includes('stageAllowsPaymentEvidence'), 'stage payment proof CTA remains gated by authoritative customer acceptance');
must(paymentsSection.includes('canOperate') && paymentsSection.includes("role === 'customer'"), 'proof CTA is capability and role gated');
must(paymentsSection.includes('RenovaTheme.minTouch') && paymentsSection.includes('RenovaTheme.spacing.lg'), 'payments interaction geometry uses shared design tokens');

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
must(confirmMutation >= 0 && confirmReconcile > confirmMutation && confirmPartial > confirmReconcile, 'confirmed payment mutation must be separated from post-commit reconciliation and partial-success UX');
const disputeMutation = sheet.indexOf('await api.disputePayment');
const disputeReconcile = sheet.indexOf("await reconcileCommittedPayment('dispute')", disputeMutation);
must(disputeMutation >= 0 && disputeReconcile > disputeMutation, 'dispute mutation truth must precede reconciliation');
const resolveMutation = sheet.indexOf('result = await api.resolvePaymentDispute');
const resolveReconcile = sheet.indexOf("await reconcileCommittedPayment('resolve_dispute')", resolveMutation);
must(resolveMutation >= 0 && resolveReconcile > resolveMutation, 'dispute resolution truth must precede reconciliation');

// C4/#746: visual/payment copy must agree with authoritative settlement paths.
must(paymentsSection.includes('SETTLEMENT_HINTS.contractorOverview')
  && paymentsSection.includes('SETTLEMENT_HINTS.customerOverview')
  && paymentsSection.includes('SETTLEMENT_HINTS.contractorPending')
  && paymentsSection.includes('SETTLEMENT_HINTS.customerPending')
  && paymentsSection.includes('SETTLEMENT_HINTS.readOnlyPending'),
  'both role summaries and pending status hints use one domain copy source');
must(sheet.includes('SETTLEMENT_HINTS.receiptAfterUnverified')
  && sheet.includes('SETTLEMENT_HINTS.receiptBeforeTransferAck')
  && sheet.includes('contractorSettlementDetail(formatRub(payment.amount))')
  && sheet.includes('SETTLEMENT_HINTS.customerDetailPending'),
  'payment detail sheet uses the same settlement authority copy');
must(!paymentsSection.includes('после того, как вы подтвердите получение'),
  'recipient confirmation must not be presented as the only way to confirm a payment');
must(!sheet.includes('счёт подтвердится автоматически'),
  'receipt scanning must not be presented as guaranteed settlement');
must(SETTLEMENT_HINTS.contractorOverview.includes('подходящего чека')
  && SETTLEMENT_HINTS.contractorOverview.includes('подтверждения получения'),
  'contractor is told both canonical settlement routes');
must(SETTLEMENT_HINTS.customerOverview.includes('Недостаточный или отклонённый чек')
  && SETTLEMENT_HINTS.customerOverview.includes('не считается проверенным ФНС'),
  'customer is told coverage, rejection and manual FNS boundaries');
must(SETTLEMENT_HINTS.receiptAfterUnverified.includes('может подтвердить')
  && !SETTLEMENT_HINTS.receiptAfterUnverified.includes('автоматически'),
  'receipt does not guarantee payment confirmation without server validation');
must(contractorSettlementDetail('5 000 ₽').includes('5 000 ₽')
  && contractorSettlementDetail('5 000 ₽').includes('чек заказчика'),
  'contractor detail uses amount while retaining alternative settlement path');

// GP5/#748: source-of-truth, API and role screens must carry cumulative refund data.
const grossNetSchema = readFileSync(join(repo, 'backend/app/schemas/project.py'), 'utf8');
const refundService = readFileSync(join(repo, 'backend/app/services/payment_reversal_service.py'), 'utf8');
const refundModel = readFileSync(join(repo, 'backend/app/models/project_payment_refund.py'), 'utf8');
const budgetSource = readFileSync(join(repo, 'backend/app/services/budget_service.py'), 'utf8');
const historyApi = readFileSync(join(repo, 'backend/app/api/v1/payment_history.py'), 'utf8');
const paymentTimeline = readFileSync(join(__dirname, 'domain/paymentHistory.ts'), 'utf8');
must(refundModel.includes('provider_refund_id') && refundModel.includes('Numeric(14, 2)'),
  'project refund has immutable provider identity and cent-precise amount');
must(refundService.includes('refunded_total') && refundService.includes('refund_exceeds_payment')
  && refundService.includes('ProjectPaymentRefund('),
  'canonical refund writer guards cumulative money');
must(budgetSource.includes('net_payment_amount') && budgetSource.includes('_receipt_financial_amount'),
  'payment and receipt hydration must not reconstruct original gross spend');
must(grossNetSchema.includes('refunded_amount: float') && grossNetSchema.includes('net_amount: float'),
  'explicit refund API fields required');
must(historyApi.includes('refund_totals_by_payment') && paymentTimeline.includes('yookassa_refund_partial'),
  'API totals and timeline share provider refund truth');
must(paymentsSection.includes('payment.refunded_amount') && paymentsSection.includes('payment.net_amount'),
  'both role payment lists surface returned and remaining money');
must(sheet.includes('payment.refunded_amount') && sheet.includes('payment.net_amount'),
  'payment detail must display actual net amount');
console.log('paymentUnverified.w143.test OK');