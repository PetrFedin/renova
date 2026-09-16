import { req, ApiError } from './client';
import { shouldQueueReplaySafeMutation } from './failurePolicy';
import { createClientRequestId } from '@/lib/clientRequestId';

export type WorkScheduleStatus = 'draft' | 'submitted' | 'confirmed' | 'rejected' | 'archived';
export type WorkScheduleItemStatus =
  | 'planned'
  | 'ready'
  | 'in_progress'
  | 'submitted'
  | 'accepted'
  | 'delayed'
  | 'blocked'
  | 'cancelled';

export type WorkScheduleItem = {
  id: string;
  schedule_id: string;
  project_id: string;
  stage_id?: string | null;
  title: string;
  description?: string | null;
  status: WorkScheduleItemStatus;
  planned_start_date: string;
  planned_finish_date: string;
  actual_start_date?: string | null;
  actual_finish_date?: string | null;
  depends_on_item_id?: string | null;
  requires_customer_acceptance: boolean;
  requires_photo: boolean;
  requires_hidden_work_acceptance: boolean;
  delay_days: number;
  blocking_reason?: string | null;
  sort_order: number;
  progress_percent: number;
  created_at: string;
  updated_at: string;
};

export type WorkSchedule = {
  id: string;
  project_id: string;
  status: WorkScheduleStatus;
  title: string;
  description?: string | null;
  planned_start_date?: string | null;
  planned_finish_date?: string | null;
  rejection_reason?: string | null;
  created_by: string;
  submitted_by?: string | null;
  confirmed_by?: string | null;
  rejected_by?: string | null;
  created_at: string;
  submitted_at?: string | null;
  confirmed_at?: string | null;
  rejected_at?: string | null;
  updated_at: string;
  items: WorkScheduleItem[];
};

export type ActiveWorkScheduleResult =
  | { kind: 'absent' }
  | { kind: 'plan'; plan: WorkSchedule };

export type WorkScheduleCreateInput = Partial<WorkSchedule> & { client_request_id?: string };

async function queueReplaySafeScheduleCommand<T>(
  userId: string,
  path: string,
  body: string,
  error: unknown,
): Promise<T> {
  if (!shouldQueueReplaySafeMutation(error)) throw error;
  const { enqueue } = await import('@/lib/offlineQueue');
  await enqueue({ path, method: 'POST', body, userId });
  throw new Error('offline_queued');
}

export const workScheduleApi = {
  listWorkSchedules: (userId: string, projectId: string) =>
    req<WorkSchedule[]>(`/api/v1/projects/${projectId}/work-schedules`, {}, userId),

  getActiveWorkSchedule: (
    userId: string,
    projectId: string,
    opts?: { signal?: AbortSignal },
  ) => req<WorkSchedule | null>(
    `/api/v1/projects/${projectId}/work-schedules/active`,
    { signal: opts?.signal, cacheFallback: false },
    userId,
  ),

  /** Absence is accepted only from a successful null response or a real 404. */
  fetchActiveSchedulePlan: async (
    userId: string,
    projectId: string,
    opts?: { signal?: AbortSignal },
  ): Promise<ActiveWorkScheduleResult> => {
    try {
      const data = await req<WorkSchedule | null>(
        `/api/v1/projects/${projectId}/work-schedules/active`,
        { signal: opts?.signal, cacheFallback: false },
        userId,
      );
      return data == null ? { kind: 'absent' } : { kind: 'plan', plan: data };
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return { kind: 'absent' };
      throw error;
    }
  },

  createWorkSchedule: async (userId: string, projectId: string, body: WorkScheduleCreateInput = {}) => {
    const requestBody = {
      ...body,
      client_request_id: body.client_request_id ?? createClientRequestId('work-schedule'),
    };
    const payload = JSON.stringify(requestBody);
    const path = `/api/v1/projects/${projectId}/work-schedules`;
    try {
      return await req<WorkSchedule>(path, { method: 'POST', body: payload }, userId);
    } catch (error) {
      return queueReplaySafeScheduleCommand<WorkSchedule>(userId, path, payload, error);
    }
  },

  submitWorkSchedule: async (userId: string, projectId: string, scheduleId: string) => {
    const path = `/api/v1/projects/${projectId}/work-schedules/${scheduleId}/submit`;
    const body = '{}';
    try {
      return await req<WorkSchedule>(path, { method: 'POST' }, userId);
    } catch (error) {
      return queueReplaySafeScheduleCommand<WorkSchedule>(userId, path, body, error);
    }
  },

  confirmWorkSchedule: async (userId: string, projectId: string, scheduleId: string) => {
    const path = `/api/v1/projects/${projectId}/work-schedules/${scheduleId}/confirm`;
    const body = '{}';
    try {
      return await req<WorkSchedule>(path, { method: 'POST' }, userId);
    } catch (error) {
      return queueReplaySafeScheduleCommand<WorkSchedule>(userId, path, body, error);
    }
  },

  rejectWorkSchedule: async (userId: string, projectId: string, scheduleId: string, reason?: string) => {
    const path = `/api/v1/projects/${projectId}/work-schedules/${scheduleId}/reject`;
    const body = JSON.stringify({ reason });
    try {
      return await req<WorkSchedule>(path, { method: 'POST', body }, userId);
    } catch (error) {
      return queueReplaySafeScheduleCommand<WorkSchedule>(userId, path, body, error);
    }
  },

  /**
   * Item-status same-state writes had an authority hole and are not yet request-ledgered.
   * Keep them fresh-only until the exact replay contract is qualified end-to-end.
   */
  updateWorkScheduleItemStatus: (
    userId: string,
    projectId: string,
    scheduleId: string,
    itemId: string,
    body: { status: WorkScheduleItemStatus; blocking_reason?: string; progress_percent?: number },
  ) => req<WorkScheduleItem>(
    `/api/v1/projects/${projectId}/work-schedules/${scheduleId}/items/${itemId}/status`,
    { method: 'POST', body: JSON.stringify(body) },
    userId,
  ),
};