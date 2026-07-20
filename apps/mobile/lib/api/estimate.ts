/** API: estimate */
import { req, cachedGet, API_BASE, ApiError } from './client';
import type { ChangeOrder, MaterialStats, User } from './types';
export const estimateApi = {
  patchEstimateLine: (userId: string, projectId: string, lineId: string, body: object) =>
    req(`/api/v1/projects/${projectId}/estimate/lines/${lineId}`, { method: 'PATCH', body: JSON.stringify(body) }, userId),
  addEstimateLine: (userId: string, projectId: string, body: object) =>
    req(`/api/v1/projects/${projectId}/estimate/lines`, { method: 'POST', body: JSON.stringify(body) }, userId),
  materialStats: (userId: string, projectId: string) => req<MaterialStats>(`/api/v1/projects/${projectId}/estimate/materials-stats`, {}, userId),
  getEstimateLockDiff: (userId: string, projectId: string) =>
    req<{
      proposed_at?: string | null;
      locked_at?: string | null;
      has_baseline: boolean;
      added: { id: string; name: string; total?: number }[];
      removed: { id: string; name: string; total?: number }[];
      changed: { id: string; name?: string; fields: Record<string, { from: unknown; to: unknown }> }[];
      baseline_total: number;
      current_total: number;
      delta_total: number;
      has_changes: boolean;
    }>(`/api/v1/projects/${projectId}/estimate/lock-diff`, {}, userId),
  lockEstimate: (userId: string, projectId: string) =>
    req<{ ok: boolean; estimate_locked_at?: string; contract?: { document_id?: string; pending_titles?: string[] } }>(
      `/api/v1/projects/${projectId}/estimate/lock`,
      { method: 'POST' },
      userId,
    ),
  /** W57: исполнитель предлагает фиксацию (без lock) */
  proposeEstimateLock: (userId: string, projectId: string) =>
    req<{ ok: boolean; code?: string; estimate_lock_proposed_at?: string }>(
      `/api/v1/projects/${projectId}/estimate/propose-lock`,
      { method: 'POST' },
      userId,
    ),
  listChangeOrders: (userId: string, projectId: string) => req<ChangeOrder[]>(`/api/v1/projects/${projectId}/change-orders`, {}, userId),
  createChangeOrder: (userId: string, projectId: string, body: object) =>
    req(`/api/v1/projects/${projectId}/change-orders`, { method: 'POST', body: JSON.stringify(body) }, userId),
  approveChangeOrder: async (userId: string, projectId: string, orderId: string) => {
    try {
      return await req<{ ok: boolean; status: string; document_id?: string; amount?: number; title?: string }>(
        `/api/v1/projects/${projectId}/change-orders/${orderId}/approve`,
        { method: 'POST' },
        userId,
      );
    } catch (e) {
      if (e instanceof ApiError) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({ path: `/api/v1/projects/${projectId}/change-orders/${orderId}/approve`, method: 'POST', body: '{}', userId });
      throw new Error('offline_queued');
    }
  },
  rejectChangeOrder: async (userId: string, projectId: string, orderId: string) => {
    try {
      return await req(`/api/v1/projects/${projectId}/change-orders/${orderId}/reject`, { method: 'POST' }, userId);
    } catch (e) {
      if (e instanceof ApiError) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({ path: `/api/v1/projects/${projectId}/change-orders/${orderId}/reject`, method: 'POST', body: '{}', userId });
      throw new Error('offline_queued');
    }
  },
  downloadEstimatePdf: async (userId: string, projectId: string) => {
    const { downloadApiPath } = await import('@/lib/downloadFile');
    await downloadApiPath(userId, `/api/v1/projects/${projectId}/estimate.pdf`, 'estimate.pdf');
  },
  exportEstimatePdf: (userId: string, projectId: string) => `${process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:8100'}/api/v1/projects/${projectId}/estimate.pdf`,
  exportEstimateXlsx: async (userId: string, projectId: string) => {
    const { downloadApiPath } = await import('@/lib/downloadFile');
    await downloadApiPath(userId, `/api/v1/projects/${projectId}/estimate.xlsx`, 'estimate.xlsx');
  },
  exportEstimateCsv: async (userId: string, projectId: string) => {
    const { downloadApiPath } = await import('@/lib/downloadFile');
    await downloadApiPath(userId, `/api/v1/projects/${projectId}/estimate.csv`, 'estimate.csv');
  },
  /** W65: заказчик отклоняет propose */
  rejectEstimateLock: (userId: string, projectId: string, reason?: string) =>
    req<{ ok: boolean }>(
      `/api/v1/projects/${projectId}/estimate/reject-lock`,
      { method: 'POST', body: JSON.stringify({ reason: reason || null }) },
      userId,
    ),
  /** W65: исполнитель отзывает propose */
  withdrawEstimateLock: (userId: string, projectId: string, reason?: string) =>
    req<{ ok: boolean }>(
      `/api/v1/projects/${projectId}/estimate/withdraw-lock`,
      { method: 'POST', body: JSON.stringify({ reason: reason || null }) },
      userId,
    ),
};

