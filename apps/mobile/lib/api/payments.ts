/** API: payments */
import { req, API_BASE, ApiError, authHeaders } from './client';
import { OFFLINE_PAYMENT_CREATE_BLOCKED } from '@/lib/offlineErrors';
import type { Payment } from './types';

export type PaymentEvidenceStatus = 'upload_pending' | 'submitted' | 'rejected' | 'approved';
export type PaymentEvidence = {
  id: string;
  project_id: string;
  payment_id: string;
  version: number;
  status: PaymentEvidenceStatus;
  original_filename: string;
  declared_content_type: string;
  verified_content_type?: string | null;
  byte_size?: number | null;
  sha256?: string | null;
  submitted_at?: string | null;
  reviewed_at?: string | null;
  rejection_reason?: string | null;
  replayed?: boolean;
};

export type PaymentEvidenceUploadIntent = PaymentEvidence & {
  upload_url: string;
  upload_method: 'PUT';
  upload_headers: Record<string, string>;
  external_presigned: boolean;
};

async function uploadPaymentEvidenceBytes(
  userId: string,
  intent: PaymentEvidenceUploadIntent,
  uri: string,
): Promise<void> {
  const source = await fetch(uri);
  if (!source.ok) throw new ApiError(source.status, 'Не удалось прочитать выбранный файл.', 'evidence_source_unreadable');
  const blob = await source.blob();
  const headers: Record<string, string> = { ...intent.upload_headers };
  if (!intent.external_presigned) Object.assign(headers, authHeaders(userId));
  let response: Response;
  try {
    response = await fetch(intent.upload_url, { method: 'PUT', headers, body: blob });
  } catch (error) {
    throw new ApiError(0, 'Загрузка подтверждения прервалась. Повторите отправку этого же файла.', 'network', error);
  }
  if (!response.ok) {
    let detail: unknown;
    try { detail = await response.json(); } catch { detail = await response.text().catch(() => undefined); }
    throw new ApiError(response.status, 'Не удалось загрузить подтверждение оплаты.', 'evidence_upload_failed', detail);
  }
}

export const paymentsApi = {
  listPayments: (userId: string, projectId: string) => req<Payment[]>(`/api/v1/projects/${projectId}/payments`, {}, userId),
  getPaymentRequisites: (userId: string, projectId: string) =>
    req<{ recipient_name?: string | null; payment_requisites?: string | null; phone?: string | null; has_bank_details: boolean }>(
      `/api/v1/projects/${projectId}/payment-requisites`, {}, userId,
    ),
  createPayment: async (userId: string, projectId: string, body: object) => {
    try {
      return await req<Payment>(`/api/v1/projects/${projectId}/payments`, { method: 'POST', body: JSON.stringify(body) }, userId);
    } catch (e) {
      if (!(e instanceof ApiError) || e.status >= 500) throw new Error(OFFLINE_PAYMENT_CREATE_BLOCKED);
      throw e;
    }
  },
  countPendingPayments: async (userId: string, projectId: string) => {
    const items = await req<Payment[]>(`/api/v1/projects/${projectId}/payments`, {}, userId);
    return items.filter((p) => p.status === 'pending').length;
  },
  checkoutYookassa: (userId: string, projectId: string, paymentId: string, body?: { portal_token?: string }) =>
    req<{ demo?: boolean; provider?: string; payment_id?: string; yookassa_payment_id?: string | null; confirmation_url?: string | null; status?: string; message?: string }>(
      `/api/v1/projects/${projectId}/payments/${paymentId}/yookassa-checkout`,
      { method: 'POST', body: body ? JSON.stringify(body) : undefined }, userId,
    ),
  /** Legacy transfer acknowledgement remains server-compatible, but manual-transfer UI uses PaymentEvidence. */
  confirmPayment: async (userId: string, projectId: string, paymentId: string, opts?: { transfer_ack?: boolean }) => {
    const body = JSON.stringify({ transfer_ack: Boolean(opts?.transfer_ack) });
    try {
      return await req<Payment>(`/api/v1/projects/${projectId}/payments/${paymentId}/confirm`, { method: 'POST', body }, userId);
    } catch (e) {
      if (e instanceof ApiError) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({ path: `/api/v1/projects/${projectId}/payments/${paymentId}/confirm`, method: 'POST', body, userId });
      throw new Error('offline_queued');
    }
  },
  listPaymentEvidence: (userId: string, projectId: string, paymentId: string) =>
    req<PaymentEvidence[]>(`/api/v1/projects/${projectId}/payments/${paymentId}/evidence`, { cacheFallback: false }, userId),
  createPaymentEvidenceUploadIntent: (
    userId: string, projectId: string, paymentId: string,
    body: { client_request_id: string; original_filename: string; content_type: string },
  ) => req<PaymentEvidenceUploadIntent>(
    `/api/v1/projects/${projectId}/payments/${paymentId}/evidence/upload-intent`,
    { method: 'POST', body: JSON.stringify(body) }, userId,
  ),
  uploadPaymentEvidenceBytes,
  submitPaymentEvidence: (
    userId: string, projectId: string, paymentId: string, evidenceId: string,
    body: { client_request_id: string },
  ) => req<PaymentEvidence>(
    `/api/v1/projects/${projectId}/payments/${paymentId}/evidence/${evidenceId}/submit`,
    { method: 'POST', body: JSON.stringify(body) }, userId,
  ),
  disputePayment: (userId: string, projectId: string, paymentId: string, body: { reason: string }) =>
    req<{ payment: Payment; changed: boolean; replayed: boolean }>(
      `/api/v1/projects/${projectId}/payments/${paymentId}/dispute`, { method: 'POST', body: JSON.stringify(body) }, userId,
    ),
  resolvePaymentDispute: (userId: string, projectId: string, paymentId: string, body: { note: string }) =>
    req<{ payment: Payment; changed: boolean; replayed: boolean }>(
      `/api/v1/projects/${projectId}/payments/${paymentId}/dispute/resolve`, { method: 'POST', body: JSON.stringify(body) }, userId,
    ),
};