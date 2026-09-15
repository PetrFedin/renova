/** Reversible lifecycle for manual/imported estimate lines. */
import { ApiError, req } from './client';

export type EstimateLineOrigin = 'system' | 'manual' | 'import';
export type EstimateLineLifecycleStatus = 'active' | 'removed';

export type EstimateLifecycleLine = {
  id: string;
  project_id: string;
  origin: EstimateLineOrigin;
  lifecycle_status: EstimateLineLifecycleStatus;
  line_type: string;
  name: string;
  unit: string;
  quantity_planned: number;
  quantity_actual: number;
  unit_price: number;
  room_name?: string | null;
  room_id?: string | null;
  category?: string | null;
  calc_detail?: string | null;
  notes?: string | null;
  removed_at?: string | null;
  removed_by?: string | null;
  restored_at?: string | null;
  restored_by?: string | null;
  total: number;
  idempotent_replay?: boolean;
};

export type EstimateLifecycleSnapshot = {
  active: EstimateLifecycleLine[];
  removed: EstimateLifecycleLine[];
};

async function reversibleTransition(
  userId: string,
  projectId: string,
  lineId: string,
  action: 'remove' | 'restore',
): Promise<EstimateLifecycleLine> {
  const path = `/api/v1/projects/${projectId}/estimate/lines/${lineId}/${action}`;
  try {
    return await req<EstimateLifecycleLine>(path, { method: 'POST' }, userId);
  } catch (error) {
    // Both transitions are server-idempotent. A transport/5xx ambiguity can be
    // replayed from the durable queue; deterministic 4xx never enters it.
    if (error instanceof ApiError && error.status >= 400 && error.status < 500) throw error;
    const { enqueue } = await import('@/lib/offlineQueue');
    await enqueue({ path, method: 'POST', body: '{}', userId });
    throw new Error('offline_queued');
  }
}

export const estimateLifecycleApi = {
  getEstimateLineLifecycle: (
    userId: string,
    projectId: string,
  ) => req<EstimateLifecycleSnapshot>(
    `/api/v1/projects/${projectId}/estimate/lines/lifecycle`,
    {},
    userId,
  ),

  removeEstimateLine: (
    userId: string,
    projectId: string,
    lineId: string,
  ) => reversibleTransition(userId, projectId, lineId, 'remove'),

  restoreEstimateLine: (
    userId: string,
    projectId: string,
    lineId: string,
  ) => reversibleTransition(userId, projectId, lineId, 'restore'),
};
