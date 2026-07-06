/** API: misc */
import { req, cachedGet, API_BASE } from './client';
import type { ApprovalItem, ArticleDetail, ArticleSummary, ProjectDetail } from './types';
export const miscApi = {
  listArticles: (category?: string) => req<ArticleSummary[]>(`/api/v1/articles${category ? `?category=${category}` : ''}`),
  getArticle: (slug: string) => req<ArticleDetail>(`/api/v1/articles/${slug}`),
  listViewers: (userId: string, projectId: string) => req<{ user_id: string; phone: string; full_name?: string; role: string }[]>(`/api/v1/projects/${projectId}/viewers`, {}, userId),
  shareViewer: (userId: string, projectId: string, body: { phone?: string; profile_code?: string }) =>
    req(`/api/v1/projects/${projectId}/viewers`, { method: 'POST', body: JSON.stringify(body) }, userId),
  linkContractor: (userId: string, projectId: string, contractorId: string) =>
    req<ProjectDetail>(`/api/v1/projects/${projectId}/contractor`, { method: 'POST', body: JSON.stringify({ contractor_id: contractorId }) }, userId),
  removeViewer: (userId: string, projectId: string, viewerUserId: string) => req(`/api/v1/projects/${projectId}/viewers/${viewerUserId}`, { method: 'DELETE' }, userId),
  approvalHub: (userId: string, projectId: string) => req<{ pending_count: number; items: ApprovalItem[] }>(`/api/v1/projects/${projectId}/approvals`, {}, userId),
  rejectApproval: (userId: string, projectId: string, itemId: string, type: string, reason: string) => req(`/api/v1/projects/${projectId}/approvals/${itemId}/reject`, { method: 'POST', body: JSON.stringify({ type, reason }) }, userId),
  enqueueOfflineCreate: async (path: string, method: string, body: object, userId: string) => { const { enqueue } = await import('@/lib/offlineQueue'); await enqueue({ path, method, body: JSON.stringify(body), userId }); },
};
