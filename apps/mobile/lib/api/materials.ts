/** API: materials */
import { req, cachedGet, invalidateCachedGet, ApiError } from './client';
import { isQueueableWriteError } from './queueableError';
import type { MaterialPick, MaterialSupplySource, Purchase } from './types';
import { createClientRequestId } from '@/lib/clientRequestId';
export const materialsApi = {
  /** Polled from home digest, budget, room detail, estimate — общий TTL-кэш вместо N независимых опросов (#432). */
  listMaterialPicks: (userId: string, projectId: string, workType?: string) => cachedGet<MaterialPick[]>(`/api/v1/projects/${projectId}/material-picks${workType ? `?work_type=${workType}` : ''}`, userId),
  createMaterialPick: async (userId: string, projectId: string, body: object) => {
    const input = body as Record<string, unknown> & { client_request_id?: string };
    const requestBody = {
      ...input,
      client_request_id: input.client_request_id ?? createClientRequestId('material-pick'),
    };
    const serialized = JSON.stringify(requestBody);
    try {
      const created = await req<MaterialPick>(`/api/v1/projects/${projectId}/material-picks`, { method: 'POST', body: serialized }, userId);
      await invalidateCachedGet(`/api/v1/projects/${projectId}/material-picks`, userId);
      return created;
    } catch (e) {
      if (!isQueueableWriteError(e)) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({ path: `/api/v1/projects/${projectId}/material-picks`, method: 'POST', body: serialized, userId });
      throw new Error('offline_queued');
    }
  },
  submitMaterialPick: async (userId: string, projectId: string, id: string) => {
    try {
      const result = await req(`/api/v1/projects/${projectId}/material-picks/${id}/submit`, { method: 'POST' }, userId);
      await invalidateCachedGet(`/api/v1/projects/${projectId}/material-picks`, userId);
      return result;
    } catch (e) {
      if (!isQueueableWriteError(e)) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({ path: `/api/v1/projects/${projectId}/material-picks/${id}/submit`, method: 'POST', body: '{}', userId });
      throw new Error('offline_queued');
    }
  },
  approveMaterialPick: async (userId: string, projectId: string, id: string) => {
    try {
      const result = await req(`/api/v1/projects/${projectId}/material-picks/${id}/approve`, { method: 'POST' }, userId);
      await invalidateCachedGet(`/api/v1/projects/${projectId}/material-picks`, userId);
      return result;
    } catch (e) {
      if (!isQueueableWriteError(e)) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({ path: `/api/v1/projects/${projectId}/material-picks/${id}/approve`, method: 'POST', body: '{}', userId });
      throw new Error('offline_queued');
    }
  },
  rejectMaterialPick: async (userId: string, projectId: string, id: string, reason?: string) => {
    const body = JSON.stringify({ reason: reason || null });
    try {
      const result = await req(`/api/v1/projects/${projectId}/material-picks/${id}/reject`, { method: 'POST', body }, userId);
      await invalidateCachedGet(`/api/v1/projects/${projectId}/material-picks`, userId);
      return result;
    } catch (e) {
      if (!isQueueableWriteError(e)) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({ path: `/api/v1/projects/${projectId}/material-picks/${id}/reject`, method: 'POST', body, userId });
      throw new Error('offline_queued');
    }
  },
  updateMaterialSupply: (
    userId: string,
    projectId: string,
    pickId: string,
    supply: { supply_source: MaterialSupplySource; qty_available: number },
  ) => req<MaterialPick>(
    `/api/v1/projects/${projectId}/material-picks/${pickId}/supply`,
    { method: 'PATCH', body: JSON.stringify(supply) },
    userId,
  ),
  getMaterialPriceTruth: (userId: string, projectId: string, pickId: string) => req<MaterialPick>(
    `/api/v1/projects/${projectId}/material-picks/${pickId}/price-truth`,
    {},
    userId,
  ),
  setMaterialPrice: (userId: string, projectId: string, pickId: string, price: number) => req<MaterialPick>(
    `/api/v1/projects/${projectId}/material-picks/${pickId}/price`,
    { method: 'PATCH', body: JSON.stringify({ price }) },
    userId,
  ),
  syncMaterialPrice: (userId: string, projectId: string, pickId: string) => req<MaterialPick>(`/api/v1/projects/${projectId}/material-picks/${pickId}/sync-price`, { method: 'POST' }, userId),
  listPurchases: (userId: string, projectId: string) => req<Purchase[]>(`/api/v1/projects/${projectId}/purchases`, {}, userId),
  listPurchasesFresh: (
    userId: string,
    projectId: string,
    options?: { signal?: AbortSignal },
  ) => req<Purchase[]>(
    `/api/v1/projects/${projectId}/purchases`,
    { signal: options?.signal, cacheFallback: false },
    userId,
  ),
  createPurchase: async (userId: string, projectId: string, material_pick_ids: string[], supplier_name?: string) => {
    const requestBody = {
      material_pick_ids,
      supplier_name,
      client_request_id: createClientRequestId('purchase'),
    };
    const serialized = JSON.stringify(requestBody);
    try {
      return await req<Purchase>(`/api/v1/projects/${projectId}/purchases`, { method: 'POST', body: serialized }, userId);
    } catch (e) {
      if (!isQueueableWriteError(e)) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({ path: `/api/v1/projects/${projectId}/purchases`, method: 'POST', body: serialized, userId });
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
      if (!isQueueableWriteError(e)) throw e;
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
    // #419: mint the client_request_id once, before the first send, and
    // replay the exact same serialized body on every offline-queue retry so
    // a lost response after the server already generated the material needs
    // cannot regenerate (and duplicate) them on resend.
    const requestBody = JSON.stringify({ client_request_id: createClientRequestId('material-needs-generate') });
    try {
      return await req<{ count: number; created: { id: string; name: string }[] }>(
        `/api/v1/projects/${projectId}/material-needs/from-estimate`,
        { method: 'POST', body: requestBody },
        userId,
      );
    } catch (e) {
      if (!isQueueableWriteError(e)) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({
        path: `/api/v1/projects/${projectId}/material-needs/from-estimate`,
        method: 'POST',
        body: requestBody,
        userId,
      });
      throw new Error('offline_queued');
    }
  },
};