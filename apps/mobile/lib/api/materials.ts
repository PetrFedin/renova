/** API: materials */
import { req, cachedGet, API_BASE, ApiError } from './client';
import type { MaterialPick, Purchase } from './types';
export const materialsApi = {
  listMaterialPicks: (userId: string, projectId: string, workType?: string) => req<MaterialPick[]>(`/api/v1/projects/${projectId}/material-picks${workType ? `?work_type=${workType}` : ''}`, {}, userId),
  createMaterialPick: (userId: string, projectId: string, body: object) => req<MaterialPick>(`/api/v1/projects/${projectId}/material-picks`, { method: 'POST', body: JSON.stringify(body) }, userId),
  submitMaterialPick: (userId: string, projectId: string, id: string) => req(`/api/v1/projects/${projectId}/material-picks/${id}/submit`, { method: 'POST' }, userId),
  approveMaterialPick: async (userId: string, projectId: string, id: string) => {
    try {
      return await req(`/api/v1/projects/${projectId}/material-picks/${id}/approve`, { method: 'POST' }, userId);
    } catch (e) {
      if (e instanceof ApiError) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({ path: `/api/v1/projects/${projectId}/material-picks/${id}/approve`, method: 'POST', body: '{}', userId });
      throw new Error('offline_queued');
    }
  },
  syncMaterialPrice: (userId: string, projectId: string, pickId: string) => req<MaterialPick>(`/api/v1/projects/${projectId}/material-picks/${pickId}/sync-price`, { method: 'POST' }, userId),
  listPurchases: (userId: string, projectId: string) => req<Purchase[]>(`/api/v1/projects/${projectId}/purchases`, {}, userId),
  createPurchase: async (userId: string, projectId: string, material_pick_ids: string[], supplier_name?: string) => {
    const body = JSON.stringify({ material_pick_ids, supplier_name });
    try {
      return await req<Purchase>(`/api/v1/projects/${projectId}/purchases`, { method: 'POST', body }, userId);
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({ path: `/api/v1/projects/${projectId}/purchases`, method: 'POST', body, userId });
      throw new Error('offline_queued');
    }
  },
  updatePurchaseStatus: async (userId: string, projectId: string, purchaseId: string, status: string) => {
    const body = JSON.stringify({ status });
    try {
      return await req<Purchase>(
        `/api/v1/projects/${projectId}/purchases/${purchaseId}/status`,
        { method: 'POST', body },
        userId,
      );
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({
        path: `/api/v1/projects/${projectId}/purchases/${purchaseId}/status`,
        method: 'POST',
        body,
        userId,
      });
      throw new Error('offline_queued');
    }
  },
  generateMaterialNeeds: async (userId: string, projectId: string) => {
    try {
      return await req<{ count: number; created: { id: string; name: string }[] }>(
        `/api/v1/projects/${projectId}/material-needs/from-estimate`,
        { method: 'POST' },
        userId,
      );
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({
        path: `/api/v1/projects/${projectId}/material-needs/from-estimate`,
        method: 'POST',
        body: '{}',
        userId,
      });
      throw new Error('offline_queued');
    }
  },
};
