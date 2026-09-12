/** API: workOrders — offline replay-safe field mutations. */
import { req, ApiError } from './client';
import { getFailureStatus } from './failurePolicy';
import { createClientRequestId } from '@/lib/clientRequestId';
import type { WorkOrder } from './types';

export type WorkOrderPatchBody = {
  expected_updated_at: string;
  [key: string]: unknown;
};

export type WorkOrderCreateBody = Record<string, unknown> & {
  client_request_id?: string;
};

function errorName(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('name' in error)) return undefined;
  return typeof error.name === 'string' ? error.name : undefined;
}

function canQueueReplaySafeCreate(error: unknown): boolean {
  const name = errorName(error);
  if (name === 'AbortError') return false;
  const status = getFailureStatus(error);
  if (status !== undefined) return status === 0 || status === 429 || status >= 500;
  // JSON parse failures can originate in another VM/JS realm, where
  // `instanceof SyntaxError` is false. Error name is the cross-realm contract.
  // A malformed 2xx is ambiguous: the server may already have committed, so the
  // exact stable intent may be replayed safely.
  return name === 'SyntaxError';
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
  createWorkOrder: async (userId: string, projectId: string, body: WorkOrderCreateBody) => {
    const client_request_id = typeof body.client_request_id === 'string' && body.client_request_id
      ? body.client_request_id
      : createClientRequestId('work-order');
    const serialized = JSON.stringify({ ...body, client_request_id });
    const path = `/api/v1/projects/${projectId}/work-orders`;
    try {
      return await req<WorkOrder>(path, { method: 'POST', body: serialized }, userId);
    } catch (error) {
      if (!canQueueReplaySafeCreate(error)) throw error;
      const { enqueue } = await import('@/lib/offlineQueue');
      // The intent exists before the first send. Persist the exact first bytes so a
      // lost response cannot mint another WorkOrder on flush or app restart.
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