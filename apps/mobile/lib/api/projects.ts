/** API: projects */
import { req, cachedGet, API_BASE, ApiError } from './client';
import { getAttemptKey, releaseAttemptKey } from './attemptKey';
import { isQueueableWriteError } from './queueableError';
import type { Dashboard, ProjectDetail, ProjectSummary } from './types';
export type PurgeBlockReason = { code: string; message: string; count: number };
export type SkippedTrashProject = {
  project_id: string;
  name: string;
  code: string;
  reasons: PurgeBlockReason[];
};
export type EmptyTrashResult = { deleted: number; skipped?: SkippedTrashProject[] };

async function createOnce<T>(userId: string, scope: string, path: string, body: object): Promise<T> {
  const given = (body as { client_request_id?: string }).client_request_id;
  const base = JSON.stringify(body);
  const key = given || getAttemptKey(userId, scope, base);
  const requestBody = JSON.stringify({ ...body, client_request_id: key });
  try {
    const created = await req<T>(path, { method: 'POST', body: requestBody }, userId);
    releaseAttemptKey(userId, scope, base);
    return created;
  } catch (e) {
    // Исход неизвестен (обрыв/5xx/429) — ключ остаётся для повтора. Авторитетный
    // отказ сервера закрывает попытку.
    if (e instanceof ApiError && !isQueueableWriteError(e)) releaseAttemptKey(userId, scope, base);
    throw e;
  }
}

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
    req<EmptyTrashResult>(`/api/v1/projects/trash/empty`, { method: 'DELETE' }, userId),
  getProject: (userId: string, id: string) => req<ProjectDetail>(`/api/v1/projects/${id}`, {}, userId),
  listProjectTemplates: (userId: string) =>
    req<{ items: { id: string; label: string; renovation_type: string; property_type: string; rooms_count: number }[] }>(
      '/api/v1/projects/templates', {}, userId,
    ),
  createProjectFromTemplate: (userId: string, body: { template_id: string; name?: string }) =>
    createOnce<ProjectDetail>(userId, 'project-from-template', '/api/v1/projects/from-template', body),
  /**
   * CMP-005: сервер идемпотентен по client_request_id. Ключ один на попытку:
   * «Повторить» после таймаута/сбоя следующего шага мастера шлёт тот же ключ
   * и получает тот же проект, а не второй.
   */
  createProject: (userId: string, body: object) =>
    createOnce<ProjectDetail>(userId, 'project-create', '/api/v1/projects', body),
  patchProject: (userId: string, projectId: string, body: object) =>
    req<ProjectDetail>(`/api/v1/projects/${projectId}`, { method: 'PATCH', body: JSON.stringify(body) }, userId),
  dashboard: (userId: string, id: string) => req<Dashboard>(`/api/v1/projects/${id}/dashboard`, {}, userId),
  getAnalytics: (userId: string, projectId: string) => req(`/api/v1/projects/${projectId}/analytics`, {}, userId),
  getContractorAnalytics: (userId: string) => req<{ id: string; name: string; margin_estimated: number; progress_percent: number }[]>('/api/v1/projects/analytics/contractor-summary', {}, userId),
  getContractGate: (userId: string, projectId: string) =>
    req<{ ok: boolean; code?: string; message?: string; pending_titles?: string[]; reason?: string }>(
      `/api/v1/projects/${projectId}/contract-gate`,
      {},
      userId,
    ),
  /** «Создать договор» при reason=no_contract: идемпотентно, только стороны договора. */
  createProjectContract: (userId: string, projectId: string) =>
    req<{ created: boolean; document_id: string }>(
      `/api/v1/projects/${projectId}/contract`,
      { method: 'POST' },
      userId,
    ),
};
