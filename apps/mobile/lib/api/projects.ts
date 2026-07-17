/** API: projects */
import { req, cachedGet, API_BASE } from './client';
import type { Dashboard, ProjectDetail, ProjectSummary } from './types';
export const projectsApi = {
  listProjects: (userId: string) => cachedGet<ProjectSummary[]>("/api/v1/projects", userId),
  listProjectsByBucket: (userId: string, bucket: 'active' | 'archived' | 'trashed') =>
    cachedGet<ProjectSummary[]>(`/api/v1/projects?bucket=${bucket}`, userId),
  archiveProject: (userId: string, projectId: string) =>
    req<ProjectSummary>(`/api/v1/projects/${projectId}/archive`, { method: 'POST' }, userId),
  unarchiveProject: (userId: string, projectId: string) =>
    req<ProjectSummary>(`/api/v1/projects/${projectId}/unarchive`, { method: 'POST' }, userId),
  trashProject: (userId: string, projectId: string) =>
    req<ProjectSummary>(`/api/v1/projects/${projectId}/trash`, { method: 'POST' }, userId),
  restoreProject: (userId: string, projectId: string) =>
    req<ProjectSummary>(`/api/v1/projects/${projectId}/restore`, { method: 'POST' }, userId),
  purgeProject: (userId: string, projectId: string) =>
    req<{ ok: boolean }>(`/api/v1/projects/${projectId}`, { method: 'DELETE' }, userId),
  emptyProjectTrash: (userId: string) =>
    req<{ deleted: number }>(`/api/v1/projects/trash/empty`, { method: 'DELETE' }, userId),
  getProject: (userId: string, id: string) => req<ProjectDetail>(`/api/v1/projects/${id}`, {}, userId),
  createProject: (userId: string, body: object) => req<ProjectDetail>('/api/v1/projects', { method: 'POST', body: JSON.stringify(body) }, userId),
  patchProject: (userId: string, projectId: string, body: object) =>
    req<ProjectDetail>(`/api/v1/projects/${projectId}`, { method: 'PATCH', body: JSON.stringify(body) }, userId),
  dashboard: (userId: string, id: string) => req<Dashboard>(`/api/v1/projects/${id}/dashboard`, {}, userId),
  assignProject: (userId: string, projectId: string) => req<ProjectDetail>(`/api/v1/projects/${projectId}/assign`, { method: 'POST' }, userId),
  getAnalytics: (userId: string, projectId: string) => req(`/api/v1/projects/${projectId}/analytics`, {}, userId),
  getContractorAnalytics: (userId: string) => req<{ id: string; name: string; margin_estimated: number; progress_percent: number }[]>('/api/v1/projects/analytics/contractor-summary', {}, userId),
  getContractGate: (userId: string, projectId: string) =>
    req<{ ok: boolean; code?: string; message?: string; pending_titles?: string[]; reason?: string }>(
      `/api/v1/projects/${projectId}/contract-gate`,
      {},
      userId,
    ),
};
