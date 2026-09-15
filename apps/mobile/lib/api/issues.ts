/** API: issues */
import { req, ApiError } from './client';
import type { ProjectIssue } from './types';
import { createClientRequestId } from '@/lib/clientRequestId';

async function enqueueOffline(path: string, method: string, body: string | undefined, userId: string) {
  const { enqueue } = await import('@/lib/offlineQueue');
  await enqueue({ path, method, body: body ?? '', userId });
  throw new Error('offline_queued');
}

export type CreateIssueBody = {
  title: string;
  description?: string | null;
  room_id?: string | null;
  stage_id?: string | null;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  floor_plan_id?: string | null;
  x_pct?: number | null;
  y_pct?: number | null;
  photo_key?: string | null;
  client_request_id?: string;
};

export const issuesApi = {
  listIssues: (userId: string, projectId: string, status?: string) => req<ProjectIssue[]>(`/api/v1/projects/${projectId}/issues${status ? `?status=${status}` : ''}`, {}, userId),
  createIssue: async (userId: string, projectId: string, body: CreateIssueBody) => {
    // P0 #316: create identity exists before the first network attempt and the
    // exact serialized command is persisted if the response is lost.
    const requestBody = {
      ...body,
      client_request_id: body.client_request_id ?? createClientRequestId('issue'),
    };
    const serialized = JSON.stringify(requestBody);
    try {
      return await req<ProjectIssue & { idempotent_replay?: boolean }>(
        `/api/v1/projects/${projectId}/issues`,
        { method: 'POST', body: serialized },
        userId,
      );
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) throw e;
      await enqueueOffline(`/api/v1/projects/${projectId}/issues`, 'POST', serialized, userId);
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
  transitionIssue: async (userId: string, projectId: string, issueId: string, status: string) => {
    const path = `/api/v1/projects/${projectId}/issues/${issueId}/transition`;
    const body = JSON.stringify({ status });
    try {
      return await req<ProjectIssue>(path, { method: 'POST', body }, userId);
    } catch (e) {
      if (e instanceof ApiError) throw e;
      await enqueueOffline(path, 'POST', body, userId);
    }
  },
  /** @deprecated use transitionIssue for QC lifecycle; kept for legacy warranty/old clients. */
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
