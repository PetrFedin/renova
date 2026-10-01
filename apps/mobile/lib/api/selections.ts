/** P2.2: selections tracker API — W109 offline queue for field propose/approve */
import { req, cachedGet, invalidateCachedGet, ApiError } from './client';
import { isQueueableWriteError } from './queueableError';
import { createClientRequestId } from '@/lib/clientRequestId';

export type SelectionItem = {
  id: string;
  project_id: string;
  room_id: string | null;
  category: string;
  title: string;
  sku: string | null;
  allowance: number | null;
  price: number;
  shop_url: string | null;
  shop_name: string | null;
  status: string;
  notes: string | null;
  proposed_by_id: string | null;
  approved_at: string | null;
  created_at: string | null;
  over_allowance?: boolean;
};

async function withOffline<T>(
  run: () => Promise<T>,
  enqueuePath: string,
  method: 'POST' | 'PATCH',
  body: string,
  userId: string,
): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (!isQueueableWriteError(e)) throw e;
    const { enqueue } = await import('@/lib/offlineQueue');
    await enqueue({ path: enqueuePath, method, body, userId });
    throw new Error('offline_queued');
  }
}

export const selectionsApi = {
  listSelections: (userId: string, projectId: string, params?: { room_id?: string; category?: string; status?: string }) => {
    const q = new URLSearchParams();
    if (params?.room_id) q.set('room_id', params.room_id);
    if (params?.category) q.set('category', params.category);
    if (params?.status) q.set('status', params.status);
    const qs = q.toString();
    return req<SelectionItem[]>(`/api/v1/projects/${projectId}/selections${qs ? `?${qs}` : ''}`, {}, userId);
  },
  /** Опрашивается из нескольких независимых счётчиков одновременно — общий TTL-кэш (#432). */
  selectionsPendingCount: (userId: string, projectId: string) =>
    cachedGet<{ count: number }>(`/api/v1/projects/${projectId}/selections/pending-count`, userId),
  createSelection: (userId: string, projectId: string, body: {
    title: string;
    room_id?: string | null;
    category?: string;
    sku?: string | null;
    allowance?: number | null;
    price?: number;
    shop_url?: string | null;
    shop_name?: string | null;
    notes?: string | null;
  }) => {
    // Same client_request_id and exact serialized body is sent on the first
    // attempt and on every offline replay so a lost response cannot create a
    // duplicate SelectionItem (#415, following the #316/#398 pattern).
    const requestBody = JSON.stringify({ ...body, client_request_id: createClientRequestId('selection-create') });
    return withOffline(
      async () => {
        const created = await req<SelectionItem>(`/api/v1/projects/${projectId}/selections`, { method: 'POST', body: requestBody }, userId);
        await invalidateCachedGet(`/api/v1/projects/${projectId}/selections/pending-count`, userId);
        return created;
      },
      `/api/v1/projects/${projectId}/selections`,
      'POST',
      requestBody,
      userId,
    );
  },
  proposeSelection: (userId: string, projectId: string, id: string) =>
    withOffline(
      async () => {
        const updated = await req<SelectionItem>(`/api/v1/projects/${projectId}/selections/${id}/propose`, { method: 'POST', body: '{}' }, userId);
        await invalidateCachedGet(`/api/v1/projects/${projectId}/selections/pending-count`, userId);
        return updated;
      },
      `/api/v1/projects/${projectId}/selections/${id}/propose`,
      'POST',
      '{}',
      userId,
    ),
  /** EST-013: qty/unit — необязательные; без них закупка создаётся на 1 шт. */
  approveSelection: (userId: string, projectId: string, id: string, quantity?: { qty: number; unit: string }) => {
    const approveBody = JSON.stringify(quantity ? { qty: quantity.qty, unit: quantity.unit } : {});
    return withOffline(
      async () => {
        const updated = await req<SelectionItem>(`/api/v1/projects/${projectId}/selections/${id}/approve`, { method: 'POST', body: approveBody }, userId);
        await invalidateCachedGet(`/api/v1/projects/${projectId}/selections/pending-count`, userId);
        return updated;
      },
      `/api/v1/projects/${projectId}/selections/${id}/approve`,
      'POST',
      approveBody,
      userId,
    );
  },
  rejectSelection: (userId: string, projectId: string, id: string, reason?: string) => {
    const body = JSON.stringify({ reason: reason || null });
    return withOffline(
      async () => {
        const updated = await req<SelectionItem>(`/api/v1/projects/${projectId}/selections/${id}/reject`, { method: 'POST', body }, userId);
        await invalidateCachedGet(`/api/v1/projects/${projectId}/selections/pending-count`, userId);
        return updated;
      },
      `/api/v1/projects/${projectId}/selections/${id}/reject`,
      'POST',
      body,
      userId,
    );
  },
};
