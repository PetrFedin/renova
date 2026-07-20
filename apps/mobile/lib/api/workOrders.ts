/** API: workOrders — W111 offline queue for field transitions */
import { req, ApiError } from './client';
import type { WorkOrder } from './types';

export const workOrdersApi = {
  listWorkOrders: (userId: string, projectId: string) =>
    req<WorkOrder[]>(`/api/v1/projects/${projectId}/work-orders`, {}, userId),
  getWorkOrder: (userId: string, projectId: string, workOrderId: string) =>
    req<WorkOrder>(`/api/v1/projects/${projectId}/work-orders/${workOrderId}`, {}, userId),
  createWorkOrder: async (userId: string, projectId: string, body: object) => {
    try {
      return await req<WorkOrder>(
        `/api/v1/projects/${projectId}/work-orders`,
        { method: 'POST', body: JSON.stringify(body) },
        userId,
      );
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({
        path: `/api/v1/projects/${projectId}/work-orders`,
        method: 'POST',
        body: JSON.stringify(body),
        userId,
      });
      throw new Error('offline_queued');
    }
  },
  patchWorkOrder: async (userId: string, projectId: string, workOrderId: string, body: object) => {
    try {
      return await req<WorkOrder>(
        `/api/v1/projects/${projectId}/work-orders/${workOrderId}`,
        { method: 'PATCH', body: JSON.stringify(body) },
        userId,
      );
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
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
