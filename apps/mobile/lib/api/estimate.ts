/** API: estimate */
import { req, cachedGet, invalidateCachedGet, API_BASE, ApiError } from './client';
import type { ChangeOrder, MaterialStats, User } from './types';
import { createClientRequestId } from '@/lib/clientRequestId';
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
  /** W107/#406: новая строка сметы — очередь офлайн, replay-safe.
   * The caller (AddEstimateLineForm) mints a stable client_request_id and
   * keeps it in `body` across the first attempt and every offline-queue
   * retry, so a response lost after the server already committed the line
   * replays into the original row instead of creating a second one and
   * double-counting budget_planned. The body is serialized exactly once and
   * that same string is sent on the live attempt and queued for replay;
   * deterministic 4xx (other than 429) is authoritative and must not queue. */
  addEstimateLine: async (userId: string, projectId: string, body: object) => {
    const requestBody = JSON.stringify(body);
    try {
      return await req(
        `/api/v1/projects/${projectId}/estimate/lines`,
        { method: 'POST', body: requestBody },
        userId,
      );
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 429) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({
        path: `/api/v1/projects/${projectId}/estimate/lines`,
        method: 'POST',
        body: requestBody,
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
  lockEstimate: async (userId: string, projectId: string) => {
    // W110: фиксация сметы — очередь офлайн (симметрия propose)
    try {
      return await req<{ ok: boolean; estimate_locked_at?: string; contract?: { document_id?: string; pending_titles?: string[] } }>(
        `/api/v1/projects/${projectId}/estimate/lock`,
        { method: 'POST' },
        userId,
      );
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({ path: `/api/v1/projects/${projectId}/estimate/lock`, method: 'POST', body: '{}', userId });
      throw new Error('offline_queued');
    }
  },
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
  /** Polled from several independent widgets (estimate, home digest, inbox) — TTL cache коллапсирует повторные опросы в один сетевой вызов (#432). */
  listChangeOrders: (userId: string, projectId: string) => cachedGet<ChangeOrder[]>(`/api/v1/projects/${projectId}/change-orders`, userId),
  /** W107: допсоглашение — очередь офлайн */
  createChangeOrder: async (userId: string, projectId: string, body: object) => {
    const input = body as Record<string, unknown> & { client_request_id?: string };
    const requestBody = {
      ...input,
      client_request_id: input.client_request_id ?? createClientRequestId('change-order'),
    };
    const serialized = JSON.stringify(requestBody);
    try {
      const created = await req(
        `/api/v1/projects/${projectId}/change-orders`,
        { method: 'POST', body: serialized },
        userId,
      );
      await invalidateCachedGet(`/api/v1/projects/${projectId}/change-orders`, userId);
      return created;
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({
        path: `/api/v1/projects/${projectId}/change-orders`,
        method: 'POST',
        body: serialized,
        userId,
      });
      throw new Error('offline_queued');
    }
  },
  approveChangeOrder: async (userId: string, projectId: string, orderId: string) => {
    try {
      const result = await req<{ ok: boolean; status: string; document_id?: string; amount?: number; title?: string }>(
        `/api/v1/projects/${projectId}/change-orders/${orderId}/approve`,
        { method: 'POST' },
        userId,
      );
      await invalidateCachedGet(`/api/v1/projects/${projectId}/change-orders`, userId);
      return result;
    } catch (e) {
      if (e instanceof ApiError) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({ path: `/api/v1/projects/${projectId}/change-orders/${orderId}/approve`, method: 'POST', body: '{}', userId });
      throw new Error('offline_queued');
    }
  },
  rejectChangeOrder: async (userId: string, projectId: string, orderId: string) => {
    try {
      const result = await req(`/api/v1/projects/${projectId}/change-orders/${orderId}/reject`, { method: 'POST' }, userId);
      await invalidateCachedGet(`/api/v1/projects/${projectId}/change-orders`, userId);
      return result;
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