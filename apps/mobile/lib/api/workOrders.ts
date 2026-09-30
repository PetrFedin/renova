/** API: workOrders — W111 offline queue for field transitions */
import { req, cachedGet, invalidateCachedGet, ApiError } from './client';
import type { WorkOrder } from './types';

export type WorkOrderPatchBody = {
  expected_updated_at: string;
  [key: string]: unknown;
};

function newWorkOrderClientRequestId(): string {
  const now = Date.now().toString(36);
  const randomA = Math.random().toString(36).slice(2, 12);
  const randomB = Math.random().toString(36).slice(2, 12);
  return `wo-${now}-${randomA}-${randomB}`;
}

export const workOrdersApi = {
  /** Общий TTL-кэш: несколько виджетов опрашивают список независимо (#432). Явно свежий вариант — listWorkOrdersFresh. */
  listWorkOrders: (userId: string, projectId: string) =>
    cachedGet<WorkOrder[]>(`/api/v1/projects/${projectId}/work-orders`, userId),
  listWorkOrdersFresh: (
    userId: string,
    projectId: string,
    options?: { signal?: AbortSignal },
  ) => req<WorkOrder[]>(
    `/api/v1/projects/${projectId}/work-orders`,
    { signal: options?.signal, cacheFallback: false },
    userId,
  ),
  getWorkOrder: (userId: string, projectId: string, workOrderId: string) =>
    req<WorkOrder>(`/api/v1/projects/${projectId}/work-orders/${workOrderId}`, {}, userId),
  createWorkOrder: async (userId: string, projectId: string, body: object) => {
    // Same client_request_id is sent on the first attempt and on every offline
    // replay so a lost response cannot create a second WorkOrder (#316).
    const requestBody = JSON.stringify({ ...body, client_request_id: newWorkOrderClientRequestId() });
    try {
      const created = await req<WorkOrder>(
        `/api/v1/projects/${projectId}/work-orders`,
        { method: 'POST', body: requestBody },
        userId,
      );
      await invalidateCachedGet(`/api/v1/projects/${projectId}/work-orders`, userId);
      return created;
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({
        path: `/api/v1/projects/${projectId}/work-orders`,
        method: 'POST',
        body: requestBody,
        userId,
      });
      throw new Error('offline_queued');
    }
  },
  patchWorkOrder: async (
    userId: string,
    projectId: string,
    workOrderId: string,
    body: WorkOrderPatchBody,
  ) => {
    if (!body.expected_updated_at) throw new Error('work_order_version_missing');
    try {
      const updated = await req<WorkOrder>(
        `/api/v1/projects/${projectId}/work-orders/${workOrderId}`,
        { method: 'PATCH', body: JSON.stringify(body) },
        userId,
      );
      await invalidateCachedGet(`/api/v1/projects/${projectId}/work-orders`, userId);
      return updated;
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      // Queue the exact optimistic token observed when the edit was made. On replay,
      // a newer server revision returns 409 instead of silently losing another edit.
      await enqueue({
        path: `/api/v1/projects/${projectId}/work-orders/${workOrderId}`,
        method: 'PATCH',
        body: JSON.stringify(body),
        userId,
      });
      throw new Error('offline_queued');
    }
  },
  transitionWorkOrder: async (userId: string, projectId: string, workOrderId: string, status: string) => {
    try {
      const updated = await req<WorkOrder>(
        `/api/v1/projects/${projectId}/work-orders/${workOrderId}/transition`,
        { method: 'POST', body: JSON.stringify({ status }) },
        userId,
      );
      await invalidateCachedGet(`/api/v1/projects/${projectId}/work-orders`, userId);
      return updated;
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({
        path: `/api/v1/projects/${projectId}/work-orders/${workOrderId}/transition`,
        method: 'POST',
        body: JSON.stringify({ status }),
        userId,
      });
      throw new Error('offline_queued');
    }
  },
};
