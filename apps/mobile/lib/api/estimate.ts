/** API: estimate */
import { req, cachedGet, API_BASE, ApiError } from './client';
import type { ChangeOrder, MaterialStats, User } from './types';
export const estimateApi = {
  /** W107: правка строки сметы — очередь офлайн */
  patchEstimateLine: async (userId: string, projectId: string, lineId: string, body: object) => {
    try {
      return await req(
        `/api/v1/projects/${projectId}/estimate/lines/${lineId}`,
        { method: 'PATCH', body: JSON.stringify(body) },
        userId,
      );
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({
        path: `/api/v1/projects/${projectId}/estimate/lines/${lineId}`,
        method: 'PATCH',
        body: JSON.stringify(body),
        userId,
      });
      throw new Error('offline_queued');
    }
  },
  /** W107: новая строка сметы — очередь офлайн */
  addEstimateLine: async (userId: string, projectId: string, body: object) => {
    try {
      return await req(
        `/api/v1/projects/${projectId}/estimate/lines`,
        { method: 'POST', body: JSON.stringify(body) },
        userId,
      );
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({
        path: `/api/v1/projects/${projectId}/estimate/lines`,
        method: 'POST',
        body: JSON.stringify(body),
        userId,
      });
      throw new Error('offline_queued');
    }
  },
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
  proposeEstimateLock: async (userId: string, projectId: string) => {
    try {
      return await req<{ ok: boolean; code?: string; estimate_lock_proposed_at?: string }>(
        `/api/v1/projects/${projectId}/estimate/propose-lock`,
        { method: 'POST' },
        userId,
      );
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({ path: `/api/v1/projects/${projectId}/estimate/propose-lock`, method: 'POST', body: '{}', userId });
      throw new Error('offline_queued');
    }
  },
  listChangeOrders: (userId: string, projectId: string) => req<ChangeOrder[]>(`/api/v1/projects/${projectId}/change-orders`, {}, userId),
  /** W107: допсоглашение — очередь офлайн */
  createChangeOrder: async (userId: string, projectId: string, body: object) => {
    try {
      return await req(
        `/api/v1/projects/${projectId}/change-orders`,
        { method: 'POST', body: JSON.stringify(body) },
        userId,
      );
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({
        path: `/api/v1/projects/${projectId}/change-orders`,
        method: 'POST',
        body: JSON.stringify(body),
        userId,
      });
      throw new Error('offline_queued');
    }
  },
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
  /** W71: импорт строк сметы из CSV (Excel → CSV) */
  importEstimateCsv: (userId: string, projectId: string, csv_text: string) =>
    req<{ ok: boolean; created: number; skipped: number; errors?: string[]; delimiter?: string }>(
      `/api/v1/projects/${projectId}/estimate/import-csv`,
      { method: 'POST', body: JSON.stringify({ csv_text }) },
      userId,
    ),
  /** W65: заказчик отклоняет propose */
  rejectEstimateLock: async (userId: string, projectId: string, reason?: string) => {
    const body = JSON.stringify({ reason: reason || null });
    try {
      return await req<{ ok: boolean }>(
        `/api/v1/projects/${projectId}/estimate/reject-lock`,
        { method: 'POST', body },
        userId,
      );
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({ path: `/api/v1/projects/${projectId}/estimate/reject-lock`, method: 'POST', body, userId });
      throw new Error('offline_queued');
    }
  },
  /** W65: исполнитель отзывает propose */
  withdrawEstimateLock: async (userId: string, projectId: string, reason?: string) => {
    const body = JSON.stringify({ reason: reason || null });
    try {
      return await req<{ ok: boolean }>(
        `/api/v1/projects/${projectId}/estimate/withdraw-lock`,
        { method: 'POST', body },
        userId,
      );
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({ path: `/api/v1/projects/${projectId}/estimate/withdraw-lock`, method: 'POST', body, userId });
      throw new Error('offline_queued');
    }
  },
};

