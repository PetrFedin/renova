/** API: issues */
import { req, cachedGet, API_BASE, ApiError } from './client';
import type { ProjectIssue } from './types';

async function enqueueOffline(path: string, method: string, body: string | undefined, userId: string) {
  const { enqueue } = await import('@/lib/offlineQueue');
  await enqueue({ path, method, body: body ?? '', userId });
  throw new Error('offline_queued');
}

export const issuesApi = {
  listIssues: (userId: string, projectId: string, status?: string) => req<ProjectIssue[]>(`/api/v1/projects/${projectId}/issues${status ? `?status=${status}` : ''}`, {}, userId),
  createIssue: async (userId: string, projectId: string, body: object) => {
    try {
      return await req<ProjectIssue>(`/api/v1/projects/${projectId}/issues`, { method: 'POST', body: JSON.stringify(body) }, userId);
    } catch (e) {
      if (e instanceof ApiError) throw e;
      await enqueueOffline(`/api/v1/projects/${projectId}/issues`, 'POST', JSON.stringify(body), userId);
    }
  },
  escalateIssue: async (userId: string, projectId: string, issueId: string) => {
    try {
      return await req(`/api/v1/projects/${projectId}/issues/${issueId}/escalate`, { method: 'POST' }, userId);
    } catch (e) {
      if (e instanceof ApiError) throw e;
      await enqueueOffline(`/api/v1/projects/${projectId}/issues/${issueId}/escalate`, 'POST', undefined, userId);
    }
  },
  closeIssue: async (userId: string, projectId: string, issueId: string) => {
    try {
      return await req<ProjectIssue>(`/api/v1/projects/${projectId}/issues/${issueId}/close`, { method: 'POST' }, userId);
    } catch (e) {
      if (e instanceof ApiError) throw e;
      await enqueueOffline(`/api/v1/projects/${projectId}/issues/${issueId}/close`, 'POST', undefined, userId);
    }
  },
  listDependencies: (userId: string, projectId: string) => req<{ id: string; stage_id: string; stage_name?: string; depends_on_stage_name?: string; material_name?: string; dependency_type: string; status: string }[]>(`/api/v1/projects/${projectId}/dependencies`, {}, userId),
  syncDependencies: async (userId: string, projectId: string) => {
    try {
      return await req<{ created: number }>(`/api/v1/projects/${projectId}/dependencies/sync`, { method: 'POST' }, userId);
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) throw e;
      await enqueueOffline(`/api/v1/projects/${projectId}/dependencies/sync`, 'POST', undefined, userId);
    }
  },
  workflowTemplate: (workType: string) => req<{ work_type: string; name: string; steps: string[]; checklist: string[] }>(`/api/v1/workflow-templates/${workType}`),
};
