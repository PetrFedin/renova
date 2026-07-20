/** P2.2: selections tracker API — W109 offline queue for field propose/approve */
import { req, ApiError } from './client';

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
    if (e instanceof ApiError && e.status >= 400 && e.status < 500) throw e;
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
  selectionsPendingCount: (userId: string, projectId: string) =>
    req<{ count: number }>(`/api/v1/projects/${projectId}/selections/pending-count`, {}, userId),
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
  }) =>
    withOffline(
      () => req<SelectionItem>(`/api/v1/projects/${projectId}/selections`, { method: 'POST', body: JSON.stringify(body) }, userId),
      `/api/v1/projects/${projectId}/selections`,
      'POST',
      JSON.stringify(body),
      userId,
    ),
  proposeSelection: (userId: string, projectId: string, id: string) =>
    withOffline(
      () => req<SelectionItem>(`/api/v1/projects/${projectId}/selections/${id}/propose`, { method: 'POST', body: '{}' }, userId),
      `/api/v1/projects/${projectId}/selections/${id}/propose`,
      'POST',
      '{}',
      userId,
    ),
  approveSelection: (userId: string, projectId: string, id: string) =>
    withOffline(
      () => req<SelectionItem>(`/api/v1/projects/${projectId}/selections/${id}/approve`, { method: 'POST', body: '{}' }, userId),
      `/api/v1/projects/${projectId}/selections/${id}/approve`,
      'POST',
      '{}',
      userId,
    ),
  rejectSelection: (userId: string, projectId: string, id: string, reason?: string) => {
    const body = JSON.stringify({ reason: reason || null });
    return withOffline(
      () => req<SelectionItem>(`/api/v1/projects/${projectId}/selections/${id}/reject`, { method: 'POST', body }, userId),
      `/api/v1/projects/${projectId}/selections/${id}/reject`,
      'POST',
      body,
      userId,
    );
  },
};
