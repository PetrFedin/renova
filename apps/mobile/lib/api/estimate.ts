/** API: estimate */
import { req, cachedGet, API_BASE } from './client';
import type { ChangeOrder, MaterialStats, User } from './types';
export const estimateApi = {
  patchEstimateLine: (userId: string, projectId: string, lineId: string, body: object) =>
    req(`/api/v1/projects/${projectId}/estimate/lines/${lineId}`, { method: 'PATCH', body: JSON.stringify(body) }, userId),
  addEstimateLine: (userId: string, projectId: string, body: object) =>
    req(`/api/v1/projects/${projectId}/estimate/lines`, { method: 'POST', body: JSON.stringify(body) }, userId),
  materialStats: (userId: string, projectId: string) => req<MaterialStats>(`/api/v1/projects/${projectId}/estimate/materials-stats`, {}, userId),
  lockEstimate: (userId: string, projectId: string) =>
    req<{ ok: boolean; estimate_locked_at?: string; contract?: { document_id?: string; pending_titles?: string[] } }>(
      `/api/v1/projects/${projectId}/estimate/lock`,
      { method: 'POST' },
      userId,
    ),
  listChangeOrders: (userId: string, projectId: string) => req<ChangeOrder[]>(`/api/v1/projects/${projectId}/change-orders`, {}, userId),
  createChangeOrder: (userId: string, projectId: string, body: object) =>
    req(`/api/v1/projects/${projectId}/change-orders`, { method: 'POST', body: JSON.stringify(body) }, userId),
  approveChangeOrder: (userId: string, projectId: string, orderId: string) =>
    req(`/api/v1/projects/${projectId}/change-orders/${orderId}/approve`, { method: 'POST' }, userId),
  rejectChangeOrder: (userId: string, projectId: string, orderId: string) =>
    req(`/api/v1/projects/${projectId}/change-orders/${orderId}/reject`, { method: 'POST' }, userId),
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
};
