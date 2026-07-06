/** API: issues */
import { req, cachedGet, API_BASE } from './client';
import type { ProjectIssue } from './types';
export const issuesApi = {
  listIssues: (userId: string, projectId: string, status?: string) => req<ProjectIssue[]>(`/api/v1/projects/${projectId}/issues${status ? `?status=${status}` : ''}`, {}, userId),
  createIssue: (userId: string, projectId: string, body: object) => req<ProjectIssue>(`/api/v1/projects/${projectId}/issues`, { method: 'POST', body: JSON.stringify(body) }, userId),
  closeIssue: (userId: string, projectId: string, issueId: string) => req<ProjectIssue>(`/api/v1/projects/${projectId}/issues/${issueId}/close`, { method: 'POST' }, userId),
  listDependencies: (userId: string, projectId: string) => req<{ id: string; stage_id: string; stage_name?: string; depends_on_stage_name?: string; material_name?: string; dependency_type: string; status: string }[]>(`/api/v1/projects/${projectId}/dependencies`, {}, userId),
  syncDependencies: (userId: string, projectId: string) => req<{ created: number }>(`/api/v1/projects/${projectId}/dependencies/sync`, { method: 'POST' }, userId),
  workflowTemplate: (workType: string) => req<{ work_type: string; name: string; steps: string[]; checklist: string[] }>(`/api/v1/workflow-templates/${workType}`),
};
