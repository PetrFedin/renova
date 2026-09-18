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
  createWasteOrder: async (userId: string, projectId: string, body: object) => {
    try {
      return await req<WasteOrder>(
        `/api/v1/projects/${projectId}/waste-orders`,
        { method: 'POST', body: JSON.stringify(body) },
        userId,
      );
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({
        path: `/api/v1/projects/${projectId}/waste-orders`,
        method: 'POST',
        body: JSON.stringify(body),
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

/** Разметка на листе плана: линейка, карандаш, стрелки, заметки. */
export const planAnnotationsApi = {
  list: (userId: string, projectId: string, planId: string) =>
    req<{
      floor_plan_id: string;
      scale_ref_pct: number | null;
      scale_ref_m: number | null;
      items: {
        id: string;
        kind: string;
        points: { x: number; y: number }[];
        color: string;
        stroke_width: number;
        text?: string | null;
        measured_m?: number | null;
        author_id: string;
        deleted_at?: string | null;
      }[];
    }>(`/api/v1/projects/${projectId}/floor-plans/${planId}/annotations`, {}, userId),

  create: (
    userId: string,
    projectId: string,
    planId: string,
    body: {
      kind: string;
      points: { x: number; y: number }[];
      color?: string;
      stroke_width?: number;
      text?: string | null;
    },
  ) =>
    req<{ id: string; kind: string; measured_m?: number | null }>(
      `/api/v1/projects/${projectId}/floor-plans/${planId}/annotations`,
      { method: 'POST', body: JSON.stringify(body) },
      userId,
    ),

  update: (
    userId: string,
    projectId: string,
    planId: string,
    annotationId: string,
    body: { color?: string; stroke_width?: number; text?: string | null },
  ) =>
    req(
      `/api/v1/projects/${projectId}/floor-plans/${planId}/annotations/${annotationId}`,
      { method: 'PATCH', body: JSON.stringify(body) },
      userId,
    ),

  /** Стирание мягкое: пометка остаётся в истории вместе с тем, кто её убрал. */
  remove: (userId: string, projectId: string, planId: string, annotationId: string) =>
    req(
      `/api/v1/projects/${projectId}/floor-plans/${planId}/annotations/${annotationId}`,
      { method: 'DELETE' },
      userId,
    ),

  /**
   * Задать масштаб: две точки на отрезке известной длины.
   *
   * Клиент шлёт именно точки, а не готовую долю — сервер меряет их той же
   * функцией, что и все измерения, поэтому расчёты не могут разойтись.
   */
  calibrate: (
    userId: string,
    projectId: string,
    planId: string,
    body: { points: { x: number; y: number }[]; ref_m: number },
  ) =>
    req<{ scale_ref_pct: number; scale_ref_m: number }>(
      `/api/v1/projects/${projectId}/floor-plans/${planId}/calibrate`,
      { method: 'POST', body: JSON.stringify(body) },
      userId,
    ),
};
