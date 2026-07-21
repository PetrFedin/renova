import { req, ApiError } from './client';

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

export const workScheduleApi = {
  listWorkSchedules: (userId: string, projectId: string) =>
    req<WorkSchedule[]>(`/api/v1/projects/${projectId}/work-schedules`, {}, userId),

  getActiveWorkSchedule: (userId: string, projectId: string) =>
    req<WorkSchedule | null>(`/api/v1/projects/${projectId}/work-schedules/active`, {}, userId),

  createWorkSchedule: async (userId: string, projectId: string, body: Partial<WorkSchedule> = {}) => {
    const payload = JSON.stringify(body);
    try {
      return await req<WorkSchedule>(
        `/api/v1/projects/${projectId}/work-schedules`,
        { method: 'POST', body: payload },
        userId,
      );
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({ path: `/api/v1/projects/${projectId}/work-schedules`, method: 'POST', body: payload, userId });
      throw new Error('offline_queued');
    }
  },

  submitWorkSchedule: async (userId: string, projectId: string, scheduleId: string) => {
    try {
      return await req<WorkSchedule>(
        `/api/v1/projects/${projectId}/work-schedules/${scheduleId}/submit`,
        { method: 'POST' },
        userId,
      );
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({
        path: `/api/v1/projects/${projectId}/work-schedules/${scheduleId}/submit`,
        method: 'POST',
        body: '{}',
        userId,
      });
      throw new Error('offline_queued');
    }
  },

  confirmWorkSchedule: async (userId: string, projectId: string, scheduleId: string) => {
    try {
      return await req<WorkSchedule>(
        `/api/v1/projects/${projectId}/work-schedules/${scheduleId}/confirm`,
        { method: 'POST' },
        userId,
      );
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({
        path: `/api/v1/projects/${projectId}/work-schedules/${scheduleId}/confirm`,
        method: 'POST',
        body: '{}',
        userId,
      });
      throw new Error('offline_queued');
    }
  },

  rejectWorkSchedule: async (userId: string, projectId: string, scheduleId: string, reason?: string) => {
    const payload = JSON.stringify({ reason });
    try {
      return await req<WorkSchedule>(
        `/api/v1/projects/${projectId}/work-schedules/${scheduleId}/reject`,
        { method: 'POST', body: payload },
        userId,
      );
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({
        path: `/api/v1/projects/${projectId}/work-schedules/${scheduleId}/reject`,
        method: 'POST',
        body: payload,
        userId,
      });
      throw new Error('offline_queued');
    }
  },

  updateWorkScheduleItemStatus: async (
    userId: string,
    projectId: string,
    scheduleId: string,
    itemId: string,
    body: { status: WorkScheduleItemStatus; blocking_reason?: string; progress_percent?: number },
  ) => {
    // W109: статус дня графика — очередь офлайн (поле)
    try {
      return await req<WorkScheduleItem>(
        `/api/v1/projects/${projectId}/work-schedules/${scheduleId}/items/${itemId}/status`,
        { method: 'POST', body: JSON.stringify(body) },
        userId,
      );
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({
        path: `/api/v1/projects/${projectId}/work-schedules/${scheduleId}/items/${itemId}/status`,
        method: 'POST',
        body: JSON.stringify(body),
        userId,
      });
      throw new Error('offline_queued');
    }
  },
};
