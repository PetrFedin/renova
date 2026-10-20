/** API: workOrders — W111 offline queue for field transitions */
import { req, cachedGet, invalidateCachedGet, ApiError } from './client';
import { isQueueableWriteError } from './queueableError';
import type { WorkOrder } from './types';

export type ClientScopeTerms = {
  expected_updated_at: string;
  specialist_id: string;
  specialist_name: string;
  quantity: string;
  unit: string;
  unit_price_rub: string;
  amount_cap_rub: string;
  currency: 'RUB';
  inclusions: string[];
  exclusions: string[];
  deliverables: string[];
  payment_milestone: string;
  risks: string[];
};

export type ClientScopeProposalInput = {
  expected_updated_at: string;
  client_request_id: string;
  specialist_id: string;
  quantity: string;
  unit: string;
  unit_price: string;
  amount_cap: string;
  inclusions: string[];
  exclusions: string[];
  deliverables: string[];
  payment_milestone: string;
  risks: string[];
};

export type ClientScopeVersion = {
  id: string;
  project_id: string;
  work_order_id: string;
  version: number;
  digest: string;
  amount_cap_rub: string;
  decision?: 'pending' | 'approved' | 'rejected';
  decided_at?: string | null;
  replayed?: boolean;
  snapshot: {
    schema: 'renova.customer_scope.v1';
    version: number;
    work_order: {
      id: string; project_id: string; title: string; work_type: string;
      room_id: string | null; stage_id: string | null;
      planned_start: string | null; planned_end: string | null;
      assignee_id: string | null; budget_planned_rub: string;
      notes: string | null; updated_at: string;
    };
    terms: ClientScopeTerms;
    created_by: string;
  };
  authorization?: {
    id: string; cap_rub: string; committed_rub: string;
    consumed_rub: string; currency: 'RUB';
    linked_payments_qualified: false;
  } | null;
};

export type ClientScopeDecisionResult = {
  scope_version_id: string;
  decision: 'approved' | 'rejected';
  digest: string;
  authorization_id: string | null;
  replayed: boolean;
};

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
  /** No offline queue for consent: stale or unauthenticated decisions must fail closed. */
  listScopeVersions: (userId: string, projectId: string, workOrderId: string) =>
    req<{ items: ClientScopeVersion[]; financial_allocations_enforced: false; legal_signature_verified: false }>(
      `/api/v1/projects/${projectId}/scope-versions?work_order_id=${encodeURIComponent(workOrderId)}`,
      { cacheFallback: false }, userId,
    ),
  proposeScopeVersion: (userId: string, projectId: string, workOrderId: string, body: ClientScopeProposalInput) =>
    req<ClientScopeVersion>(
      `/api/v1/projects/${projectId}/work-orders/${workOrderId}/scope-versions`,
      { method: 'POST', body: JSON.stringify(body), cacheFallback: false }, userId,
    ),
  decideScopeVersion: (
    userId: string, projectId: string, scopeId: string,
    decision: 'approved' | 'rejected', digest: string, reason?: string,
  ) => req<ClientScopeDecisionResult>(
    `/api/v1/projects/${projectId}/scope-versions/${scopeId}/decision`,
    {
      method: 'POST',
      body: JSON.stringify({ decision, digest, reason: reason || null }),
      cacheFallback: false,
    },
    userId,
  ),
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
      if (!isQueueableWriteError(e)) throw e;
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
  transitionWorkOrder: async (
    userId: string,
    projectId: string,
    workOrderId: string,
    status: string,
    expectedUpdatedAt?: string | null,
  ) => {
    if (status === 'approved' && !expectedUpdatedAt) {
      throw new Error('work_order_approval_version_required');
    }
    const transitionBody = status === 'approved'
      ? { status, expected_updated_at: expectedUpdatedAt }
      : { status };
    try {
      const updated = await req<WorkOrder>(
        `/api/v1/projects/${projectId}/work-orders/${workOrderId}/transition`,
        { method: 'POST', body: JSON.stringify(transitionBody) },
        userId,
      );
      await invalidateCachedGet(`/api/v1/projects/${projectId}/work-orders`, userId);
      return updated;
    } catch (e) {
      // Explicit client approval must never be queued to execute later
      // without a fresh online check of the reviewed WorkOrder revision.
      if (status === 'approved' || !isQueueableWriteError(e)) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({
        path: `/api/v1/projects/${projectId}/work-orders/${workOrderId}/transition`,
        method: 'POST',
        body: JSON.stringify(transitionBody),
        userId,
      });
      throw new Error('offline_queued');
    }
  },
};
