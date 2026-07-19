/** API: floor */
import { req, cachedGet, API_BASE, ApiError } from './client';
import type { FloorPlan, FurnitureItem, WasteOrder } from './types';
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
  createWasteOrder: (userId: string, projectId: string, body: object) => req<WasteOrder>(`/api/v1/projects/${projectId}/waste-orders`, { method: 'POST', body: JSON.stringify(body) }, userId),
  requestWasteOrder: (userId: string, projectId: string, id: string) => req(`/api/v1/projects/${projectId}/waste-orders/${id}/request`, { method: 'POST' }, userId),
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
  completeWasteOrder: (userId: string, projectId: string, id: string) => req(`/api/v1/projects/${projectId}/waste-orders/${id}/complete`, { method: 'POST' }, userId),
};
