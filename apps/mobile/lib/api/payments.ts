/** API: payments */
import { req, cachedGet, API_BASE, ApiError } from './client';
import { OFFLINE_PAYMENT_CREATE_BLOCKED } from '@/lib/offlineErrors';
import type { Payment } from './types';
export const paymentsApi = {
  listPayments: (userId: string, projectId: string) => req<Payment[]>(`/api/v1/projects/${projectId}/payments`, {}, userId),
  getPaymentRequisites: (userId: string, projectId: string) =>
    req<{ recipient_name?: string | null; payment_requisites?: string | null; phone?: string | null; has_bank_details: boolean }>(
      `/api/v1/projects/${projectId}/payment-requisites`,
      {},
      userId,
    ),
  createPayment: async (userId: string, projectId: string, body: object) => {
    try {
      return await req<Payment>(`/api/v1/projects/${projectId}/payments`, { method: 'POST', body: JSON.stringify(body) }, userId);
    } catch (e) {
      if (!(e instanceof ApiError) || e.status >= 500) {
        throw new Error(OFFLINE_PAYMENT_CREATE_BLOCKED);
      }
      throw e;
    }
  },
  countPendingPayments: async (userId: string, projectId: string) => {
    const items = await req<Payment[]>(`/api/v1/projects/${projectId}/payments`, {}, userId);
    return items.filter((p) => p.status === 'pending').length;
  },
  checkoutYookassa: (userId: string, projectId: string, paymentId: string, body?: { portal_token?: string }) =>
    req<{ demo?: boolean; payment_id?: string; yookassa_payment_id?: string | null; confirmation_url?: string | null; status?: string; message?: string }>(
      `/api/v1/projects/${projectId}/payments/${paymentId}/yookassa-checkout`,
      { method: 'POST', body: body ? JSON.stringify(body) : undefined },
      userId,
    ),
  /** W138: transfer_ack / чек обязательны на сервере — не прямой confirm без расчёта */
  confirmPayment: async (
    userId: string,
    projectId: string,
    paymentId: string,
    opts?: { transfer_ack?: boolean },
  ) => {
    const body = JSON.stringify({ transfer_ack: Boolean(opts?.transfer_ack) });
    try {
      return await req<Payment>(
        `/api/v1/projects/${projectId}/payments/${paymentId}/confirm`,
        { method: 'POST', body },
        userId,
      );
    } catch (e) {
      if (e instanceof ApiError) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({
        path: `/api/v1/projects/${projectId}/payments/${paymentId}/confirm`,
        method: 'POST',
        body,
        userId,
      });
      throw new Error('offline_queued');
    }
  },

  /** Ручная квитанция (не YuKassa) → paid_unverified */
  submitPaymentEvidence: async (
    userId: string,
    projectId: string,
    paymentId: string,
    body: {
      file: { uri: string; name: string; type: string };
      transferDate: string; // YYYY-MM-DD
      claimedAmount: number;
      comment?: string;
      paymentReference?: string;
      clientRequestId?: string;
      expectedLockVersion?: number;
    },
  ) => {
    const form = new FormData();
    form.append('file', body.file as unknown as Blob);
    form.append('transfer_date', body.transferDate);
    form.append('claimed_amount', String(body.claimedAmount));
    if (body.comment) form.append('comment', body.comment);
    if (body.paymentReference) form.append('payment_reference', body.paymentReference);
    if (body.clientRequestId) form.append('client_request_id', body.clientRequestId);
    if (body.expectedLockVersion != null) form.append('expected_lock_version', String(body.expectedLockVersion));
    const headers: Record<string, string> = {};
    if (body.clientRequestId) headers['Idempotency-Key'] = body.clientRequestId;
    return req<{
      ok: boolean;
      idempotent_replay?: boolean;
      replaced?: boolean;
      message?: string;
      payment: Payment;
      evidence: Record<string, unknown>;
    }>(
      `/api/v1/projects/${projectId}/payments/${paymentId}/evidence`,
      { method: 'POST', body: form as unknown as BodyInit, headers } as RequestInit,
      userId,
    );
  },

  getPaymentEvidence: (userId: string, projectId: string, paymentId: string) =>
    req<{
      payment: Payment;
      evidence: {
        id: string;
        claimed_amount: number;
        transfer_date: string;
        comment?: string | null;
        payment_reference?: string | null;
        original_filename: string;
        mime_type: string;
        file_size: number;
        uploaded_by: string;
        reject_reason?: string | null;
        antivirus_scanned?: boolean;
        antivirus_status?: string;
        created_at?: string;
      } | null;
      can_review: boolean;
      can_submit: boolean;
    }>(`/api/v1/projects/${projectId}/payments/${paymentId}/evidence`, {}, userId),

  approvePaymentEvidence: (
    userId: string,
    projectId: string,
    paymentId: string,
    body?: { expected_lock_version?: number },
  ) =>
    req<{ ok: boolean; payment: Payment }>(
      `/api/v1/projects/${projectId}/payments/${paymentId}/evidence/approve`,
      { method: 'POST', body: JSON.stringify(body || {}) },
      userId,
    ),

  rejectPaymentEvidence: (
    userId: string,
    projectId: string,
    paymentId: string,
    body: { reason: string; expected_lock_version?: number },
  ) =>
    req<{ ok: boolean; payment: Payment }>(
      `/api/v1/projects/${projectId}/payments/${paymentId}/evidence/reject`,
      { method: 'POST', body: JSON.stringify(body) },
      userId,
    ),
};
