/** API: issues */
import { req, cachedGet, invalidateCachedGet, ApiError } from './client';
import { createClientRequestId } from '@/lib/clientRequestId';
import type { ProjectIssue } from './types';

async function enqueueOffline(path: string, method: string, body: string | undefined, userId: string) {
  const { enqueue } = await import('@/lib/offlineQueue');
  await enqueue({ path, method, body: body ?? '', userId });
  throw new Error('offline_queued');
}

export const issuesApi = {
  /** Общий TTL-кэш: несколько экранов опрашивают issues по фильтру статуса независимо (#432). */
  listIssues: (userId: string, projectId: string, status?: string) => cachedGet<ProjectIssue[]>(`/api/v1/projects/${projectId}/issues${status ? `?status=${status}` : ''}`, userId),
  createIssue: async (userId: string, projectId: string, body: object) => {
    // Same client_request_id and exact serialized body are sent on the
    // immediate attempt and on every offline-queue replay so a lost response
    // cannot create a duplicate ProjectIssue (#417, following the #316/#398
    // pattern). Central handling of transport-class errors (ApiError status
    // 0/429/ambiguous 5xx) before this enqueue remains out of scope — #317.
    const requestBody = JSON.stringify({ ...body, client_request_id: createClientRequestId('issue-create') });
    try {
      const created = await req<ProjectIssue>(`/api/v1/projects/${projectId}/issues`, { method: 'POST', body: requestBody }, userId);
      await invalidateCachedGet(`/api/v1/projects/${projectId}/issues`, userId);
      return created;
    } catch (e) {
      if (e instanceof ApiError) throw e;
      await enqueueOffline(`/api/v1/projects/${projectId}/issues`, 'POST', requestBody, userId);
    }
  },
  escalateIssue: async (userId: string, projectId: string, issueId: string) => {
    try {
      const result = await req(`/api/v1/projects/${projectId}/issues/${issueId}/escalate`, { method: 'POST' }, userId);
      await invalidateCachedGet(`/api/v1/projects/${projectId}/issues`, userId);
      return result;
    } catch (e) {
      if (e instanceof ApiError) throw e;
      await enqueueOffline(`/api/v1/projects/${projectId}/issues/${issueId}/escalate`, 'POST', undefined, userId);
    }
  },
  transitionIssue: async (userId: string, projectId: string, issueId: string, status: string) => {
    const path = `/api/v1/projects/${projectId}/issues/${issueId}/transition`;
    const body = JSON.stringify({ status });
    try {
      const updated = await req<ProjectIssue>(path, { method: 'POST', body }, userId);
      await invalidateCachedGet(`/api/v1/projects/${projectId}/issues`, userId);
      return updated;
    } catch (e) {
      if (e instanceof ApiError) throw e;
      await enqueueOffline(path, 'POST', body, userId);
    }
  },
  /** @deprecated use transitionIssue for QC lifecycle; kept for legacy warranty/old clients. */
  closeIssue: async (userId: string, projectId: string, issueId: string) => {
    try {
      const result = await req<ProjectIssue>(`/api/v1/projects/${projectId}/issues/${issueId}/close`, { method: 'POST' }, userId);
      await invalidateCachedGet(`/api/v1/projects/${projectId}/issues`, userId);
      return result;
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
