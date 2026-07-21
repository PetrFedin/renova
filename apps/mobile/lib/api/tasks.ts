/** API: единые счётчики задач */
import { req } from './client';
import type { TaskCounters } from '@/lib/domain/taskCounters';

export type TaskCountersQuery = {
  project: string;
  role?: string;
  timezone?: string;
  status?: string;
};

export const tasksApi = {
  getTaskCounters: (userId: string, q: TaskCountersQuery) => {
    const params = new URLSearchParams();
    params.set('project', q.project);
    if (q.role) params.set('role', q.role);
    if (q.timezone) params.set('timezone', q.timezone);
    if (q.status) params.set('status', q.status);
    return req<TaskCounters>(`/api/v1/tasks/counters?${params.toString()}`, { cacheFallback: false }, userId);
  },
};
