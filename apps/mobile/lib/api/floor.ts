/** API: floor */
import { req, cachedGet, API_BASE, ApiError } from './client';
import { shouldQueueReplaySafeMutation } from './failurePolicy';
import { createClientRequestId } from '@/lib/clientRequestId';
import type { FloorPlan, FurnitureItem, WasteOrder } from './types';

async function submitReplaySafeWasteTransition(
  userId: string,
  path: string,
) {
  try {
    return await req(path, { method: 'POST' }, userId);
  } catch (error) {
    if (!shouldQueueReplaySafeMutation(error)) throw error;
    const { enqueue } = await import('@/lib/offlineQueue');
    await enqueue({ path, method: 'POST', body: '{}', userId });
    throw new Error('offline_queued');
  }
}

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
    const requestBody = {
      ...(body as Record<string, unknown>),
      client_request_id:
        (body as { client_request_id?: string }).client_request_id
        ?? createClientRequestId('waste-order'),
    };
    const payload = JSON.stringify(requestBody);
    const path = `/api/v1/projects/${projectId}/waste-orders`;
    try {
      return await req<WasteOrder>(path, { method: 'POST', body: payload }, userId);
    } catch (error) {
      if (!shouldQueueReplaySafeMutation(error)) throw error;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({ path, method: 'POST', body: payload, userId });
      throw new Error('offline_queued');
    }
  },
  requestWasteOrder: (userId: string, projectId: string, id: string) =>
    submitReplaySafeWasteTransition(userId, `/api/v1/projects/${projectId}/waste-orders/${id}/request`),
  approveWasteOrder: (userId: string, projectId: string, id: string) =>
    submitReplaySafeWasteTransition(userId, `/api/v1/projects/${projectId}/waste-orders/${id}/approve`),
  rejectWasteOrder: (userId: string, projectId: string, id: string) =>
    submitReplaySafeWasteTransition(userId, `/api/v1/projects/${projectId}/waste-orders/${id}/reject`),
  completeWasteOrder: (userId: string, projectId: string, id: string) =>
    submitReplaySafeWasteTransition(userId, `/api/v1/projects/${projectId}/waste-orders/${id}/complete`),
};
