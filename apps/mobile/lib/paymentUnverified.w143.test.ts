/** W143: paid_unverified stays non-financial until reviewed PaymentEvidence + mobile recovery truth */
import { readFileSync } from 'fs';
import { join } from 'path';

const repo = join(__dirname, '../../..');
const svc = readFileSync(join(repo, 'backend/app/services/payment_service.py'), 'utf8');
const evidenceSvc = readFileSync(join(repo, 'backend/app/services/payment_evidence_service.py'), 'utf8');
const evidenceApi = readFileSync(join(repo, 'backend/app/api/v1/payment_evidence.py'), 'utf8');
const sheet = readFileSync(join(__dirname, '../components/renova/PaymentDetailSheet.tsx'), 'utf8');
const evidenceSheet = readFileSync(join(__dirname, '../components/renova/PaymentEvidenceSheet.tsx'), 'utf8');
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
must(evidenceSheet.includes('До одобрения файла перевод остаётся') && evidenceSheet.includes('не входит в подтверждённый расход'), 'pending evidence cannot render financial success');
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

console.log('paymentUnverified.w143.test OK');