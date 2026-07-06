/** API: estimate */
import { req, cachedGet, API_BASE } from './client';
import type { ChangeOrder, MaterialStats, User } from './types';
export const estimateApi = {
  patchEstimateLine: (userId: string, projectId: string, lineId: string, body: object) =>
    req(`/api/v1/projects/${projectId}/estimate/lines/${lineId}`, { method: 'PATCH', body: JSON.stringify(body) }, userId),
  addEstimateLine: (userId: string, projectId: string, body: object) =>
    req(`/api/v1/projects/${projectId}/estimate/lines`, { method: 'POST', body: JSON.stringify(body) }, userId),
  materialStats: (userId: string, projectId: string) => req<MaterialStats>(`/api/v1/projects/${projectId}/estimate/materials-stats`, {}, userId),
  listChangeOrders: (userId: string, projectId: string) => req<ChangeOrder[]>(`/api/v1/projects/${projectId}/change-orders`, {}, userId),
  createChangeOrder: (userId: string, projectId: string, body: object) =>
    req(`/api/v1/projects/${projectId}/change-orders`, { method: 'POST', body: JSON.stringify(body) }, userId),
  approveChangeOrder: (userId: string, projectId: string, orderId: string) =>
    req(`/api/v1/projects/${projectId}/change-orders/${orderId}/approve`, { method: 'POST' }, userId),
  rejectChangeOrder: (userId: string, projectId: string, orderId: string) =>
    req(`/api/v1/projects/${projectId}/change-orders/${orderId}/reject`, { method: 'POST' }, userId),
  downloadEstimatePdf: async (userId: string, projectId: string) => {
    const base = process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:8100';
    const r = await fetch(`${base}/api/v1/projects/${projectId}/estimate.pdf`, { headers: { 'X-User-Id': userId } });
    if (!r.ok) throw new Error('PDF error');
    const blob = await r.blob();
    if (typeof window !== 'undefined') { const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = 'estimate.pdf'; a.click(); URL.revokeObjectURL(u); }
  },
  exportEstimatePdf: (userId: string, projectId: string) => `${process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:8100'}/api/v1/projects/${projectId}/estimate.pdf`,
  exportEstimateXlsx: async (userId: string, projectId: string) => {
    const base = process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:8100';
    const r = await fetch(`${base}/api/v1/projects/${projectId}/estimate.xlsx`, { headers: { 'X-User-Id': userId } });
    if (!r.ok) throw new Error('xlsx failed');
    const blob = await r.blob();
    if (typeof window !== 'undefined') { const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = 'estimate.xls'; a.click(); URL.revokeObjectURL(u); }
  },
  exportEstimateCsv: async (userId: string, projectId: string) => {
    const base = process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:8100';
    const r = await fetch(`${base}/api/v1/projects/${projectId}/estimate.csv`, { headers: { 'X-User-Id': userId } });
    if (!r.ok) throw new Error('csv failed');
    const blob = await r.blob();
    if (typeof window !== 'undefined') { const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = 'estimate.csv'; a.click(); URL.revokeObjectURL(u); }
  },
};
