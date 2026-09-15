/** API: workOrders — W111 offline queue for field transitions */
import { req, ApiError } from './client';
import type { WorkOrder } from './types';

export type WorkOrderPatchBody = {
  expected_updated_at: string;
  [key: string]: unknown;
};

export function newWorkOrderClientRequestId(): string {
  const now = Date.now().toString(36);
  const randomA = Math.random().toString(36).slice(2, 12);
  const randomB = Math.random().toString(36).slice(2, 12);
  return `work-order-${now}-${randomA}-${randomB}`;
}

export function withWorkOrderClientRequestId(
  body: Record<string, unknown>,
  fallbackId = newWorkOrderClientRequestId(),
): Record<string, unknown> {
  const existing = body.client_request_id;
  return {
    ...body,
    client_request_id:
      typeof existing === 'string' && existing.length >= 8 ? existing : fallbackId,
  };
}

export const workOrdersApi = {
  listWorkOrders: (userId: string, projectId: string) =>
    req<WorkOrder[]>(`/api/v1/projects/${projectId}/work-orders`, {}, userId),
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
  createWorkOrder: async (userId: string, projectId: string, body: Record<string, unknown>) => {
    // Identity is generated before the first transport attempt. The exact serialized
    // command is reused if the response is lost and the operation must enter queue.
    const command = withWorkOrderClientRequestId(body);
    const serialized = JSON.stringify(command);
    try {
      return await req<WorkOrder>(
        `/api/v1/projects/${projectId}/work-orders`,
        { method: 'POST', body: serialized },
        userId,
      );
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({
        path: `/api/v1/projects/${projectId}/work-orders`,
        method: 'POST',
        body: serialized,
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
      return await req<WorkOrder>(
        `/api/v1/projects/${projectId}/work-orders/${workOrderId}`,
        { method: 'PATCH', body: JSON.stringify(body) },
        userId,
      );
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
      return await req<WorkOrder>(
        `/api/v1/projects/${projectId}/work-orders/${workOrderId}/transition`,
        { method: 'POST', body: JSON.stringify({ status }) },
        userId,
      );
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
