/** API: payments */
import { req, cachedGet, API_BASE, ApiError } from './client';
import { OFFLINE_PAYMENT_CREATE_BLOCKED } from '@/lib/offlineErrors';
import type { Payment } from './types';
export const paymentsApi = {
  listPayments: (userId: string, projectId: string) => req<Payment[]>(`/api/v1/projects/${projectId}/payments`, {}, userId),
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
  confirmPayment: async (userId: string, projectId: string, paymentId: string) => {
    try {
      return await req<Payment>(`/api/v1/projects/${projectId}/payments/${paymentId}/confirm`, { method: 'POST' }, userId);
    } catch {
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({ path: `/api/v1/projects/${projectId}/payments/${paymentId}/confirm`, method: 'POST', body: '{}', userId });
      throw new Error('offline_queued');
    }
  },
};
