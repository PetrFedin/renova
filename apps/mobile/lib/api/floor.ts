/** API: floor */
import { req, cachedGet, API_BASE, ApiError } from './client';
import type { FloorPlan, FurnitureItem, WasteOrder } from './types';
import { createClientRequestId } from '@/lib/clientRequestId';
export const floorApi = {
  listFloorPlans: (userId: string, projectId: string) => req<FloorPlan[]>(`/api/v1/projects/${projectId}/floor-plans`, {}, userId),
  createFloorPlan: (userId: string, projectId: string, body: object) => req<FloorPlan>(`/api/v1/projects/${projectId}/floor-plans`, { method: 'POST', body: JSON.stringify(body) }, userId),
  pinFloorPlanRoom: (userId: string, projectId: string, planId: string, body: object) => req(`/api/v1/projects/${projectId}/floor-plans/${planId}/pins`, { method: 'POST', body: JSON.stringify(body) }, userId),
  moveFloorPin: async (userId: string, projectId: string, planId: string, pinId: string, x_pct: number, y_pct: number) => {
    const body = { x_pct, y_pct };
    try {
      return await req(`/api/v1/projects/${projectId}/floor-plans/${planId}/pins/${pinId}`, { method: 'PATCH', body: JSON.stringify(body) }, userId);
    } catch (e) {
      if (e instanceof ApiError) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({ path: `/api/v1/projects/${projectId}/floor-plans/${planId}/pins/${pinId}`, method: 'PATCH', body: JSON.stringify(body), userId });
      throw new Error('offline_queued');
    }
  },
  listFurniture: (userId: string, projectId: string, roomId?: string) => req<FurnitureItem[]>(`/api/v1/projects/${projectId}/furniture${roomId ? `?room_id=${roomId}` : ''}`, {}, userId),
  createFurniture: (userId: string, projectId: string, body: object) => req(`/api/v1/projects/${projectId}/furniture`, { method: 'POST', body: JSON.stringify(body) }, userId),
  moveFurniture: async (userId: string, projectId: string, itemId: string, x_pct: number, y_pct: number) => {
    const body = { x_pct, y_pct };
    try {
      return await req(`/api/v1/projects/${projectId}/furniture/${itemId}`, { method: 'PATCH', body: JSON.stringify(body) }, userId);
    } catch (e) {
      if (e instanceof ApiError) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({ path: `/api/v1/projects/${projectId}/furniture/${itemId}`, method: 'PATCH', body: JSON.stringify(body), userId });
      throw new Error('offline_queued');
    }
  },
  listWasteOrders: (userId: string, projectId: string) => req<WasteOrder[]>(`/api/v1/projects/${projectId}/waste-orders`, {}, userId),
  createWasteOrder: async (userId: string, projectId: string, body: object) => {
    // #470: mint the client_request_id once, before the first send, and
    // reuse the exact same serialized body on every offline-queue replay so
    // a lost response after a server commit cannot replay as a second
    // WasteOrder. 429 is an explicit "retry later" from a server that has
    // not committed, so it is replay-safe and queues like transport/5xx;
    // any other 4xx is authoritative and must surface to the caller.
    const requestBody = JSON.stringify({ ...body, client_request_id: createClientRequestId('waste-order') });
    try {
      return await req<WasteOrder>(
        `/api/v1/projects/${projectId}/waste-orders`,
        { method: 'POST', body: requestBody },
        userId,
      );
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 429) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({
        path: `/api/v1/projects/${projectId}/waste-orders`,
        method: 'POST',
        body: requestBody,
        userId,
      });
      throw new Error('offline_queued');
    }
  },
  requestWasteOrder: async (userId: string, projectId: string, id: string) => {
    try {
      return await req(`/api/v1/projects/${projectId}/waste-orders/${id}/request`, { method: 'POST' }, userId);
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({
        path: `/api/v1/projects/${projectId}/waste-orders/${id}/request`,
        method: 'POST',
        body: '{}',
        userId,
      });
      throw new Error('offline_queued');
    }
  },
  approveWasteOrder: async (userId: string, projectId: string, id: string) => {
    try {
      return await req(`/api/v1/projects/${projectId}/waste-orders/${id}/approve`, { method: 'POST' }, userId);
    } catch (e) {
      if (e instanceof ApiError) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({ path: `/api/v1/projects/${projectId}/waste-orders/${id}/approve`, method: 'POST', body: '{}', userId });
      throw new Error('offline_queued');
    }
  },
  completeWasteOrder: async (userId: string, projectId: string, id: string) => {
    try {
      return await req(`/api/v1/projects/${projectId}/waste-orders/${id}/complete`, { method: 'POST' }, userId);
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({
        path: `/api/v1/projects/${projectId}/waste-orders/${id}/complete`,
        method: 'POST',
        body: '{}',
        userId,
      });
      throw new Error('offline_queued');
    }
  },
};
