/** API: workOrders — W111 offline queue for field transitions */
import { req, ApiError } from './client';
import type { WorkOrder } from './types';
import { createClientRequestId } from '@/lib/clientRequestId';

export type WorkOrderPatchBody = {
  expected_updated_at: string;
  [key: string]: unknown;
};

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
  createWorkOrder: async (userId: string, projectId: string, body: object) => {
    // Тело сериализуется один раз: в очередь обязан уйти ровно тот же текст,
    // что ушёл в первую попытку, иначе сервер увидит другой запрос и создаст
    // второй наряд. Ключ добавляем, если вызывающий его не дал.
    const input = body as Record<string, unknown> & { client_request_id?: string };
    const serialized = JSON.stringify({
      ...input,
      client_request_id: input.client_request_id ?? createClientRequestId('work-order'),
    });
    const path = `/api/v1/projects/${projectId}/work-orders`;
    try {
      return await req<WorkOrder>(path, { method: 'POST', body: serialized }, userId);
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({ path, method: 'POST', body: serialized, userId });
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
