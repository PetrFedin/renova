/** API: admin */
import { req, cachedGet, API_BASE } from './client';
export const adminApi = {
  linkMoyNalog: (userId: string) => req<{ linked: boolean; message: string }>('/api/v1/fns/moy-nalog/link', { method: 'POST' }, userId),
  checkNpd: (inn: string) => req('/api/v1/fns/check-npd', { method: 'POST', body: JSON.stringify({ inn }) }),
  verifyNpdMe: (userId: string, inn: string) => req<{ is_npd: boolean; message: string; badge: string }>('/api/v1/fns/verify-me', { method: 'POST', body: JSON.stringify({ inn }) }, userId),
  setMemberRole: (userId: string, memberId: string, role: string) => req('/api/v1/teams/member-role', { method: 'PATCH', body: JSON.stringify({ user_id: memberId, role }) }, userId),
  joinTeam: (userId: string, token: string) => req('/api/v1/teams/join', { method: 'POST', body: JSON.stringify({ token }) }, userId),
  getRevenueChart: (userId: string) => req<any[]>('/api/v1/admin/revenue-chart', {}, userId),
  getReleaseHealth: (userId: string) => req<any>('/api/v1/admin/release-health', {}, userId),
  getFnsHealth: (userId: string) => req<{
    receipt_auth_configured: boolean; live_verify_ready: boolean; demo_verify_allowed: boolean;
    hint: string | null; environment: string;
  }>('/api/v1/fns/health', {}, userId),
  getYookassaHealth: (userId: string) => req<{
    configured: boolean; live_checkout_ready: boolean; demo_allowed: boolean;
    shop_id_set: boolean; secret_set: boolean; webhook_secret_set: boolean;
    webhook_url: string; hint: string | null; environment: string;
  }>('/api/v1/subscription/yookassa/health', {}, userId),
  getProjectsChart: (userId: string) => req<any[]>('/api/v1/admin/projects-chart', {}, userId),
  getAdminStats: (userId: string) => req<any>('/api/v1/admin/stats', {}, userId),
  getUploadUrl: (userId: string) => req<any>('/api/v1/media/upload-url', { method: 'POST' }, userId),
  getMediaUploadUrl: (userId: string) => req<{ key: string; upload_url: string; public_url: string }>('/api/v1/media/upload-url', { method: 'POST' }, userId),
  createTeamInviteLink: (userId: string) => req<any>('/api/v1/teams/invite-link', { method: 'POST' }, userId),
  inviteTeamMember: (userId: string, phone: string, role = 'member') => req('/api/v1/teams/invite', { method: 'POST', body: JSON.stringify({ phone, role }) }, userId),
  getAuditLogs: (userId: string) => req<{ id: string; method: string; path: string; status_code: number; created_at: string }[]>('/api/v1/audit/logs', {}, userId),
  getTeam: (userId: string) => req<{ id: string; name: string; members: { user_id: string; phone: string; role: string }[] } | null>('/api/v1/teams/me', {}, userId),
  createTeam: (userId: string, name: string) => req('/api/v1/teams', { method: 'POST', body: JSON.stringify({ name }) }, userId),
  getSubscription: (userId: string) => req<{ plan: string; is_pro: boolean; price: number; free_limit: number }>('/api/v1/subscription/me', {}, userId),
  checkoutPro: (userId: string) => req('/api/v1/subscription/checkout', { method: 'POST' }, userId),
  listArticlesAdmin: (userId: string) => req<{ slug: string; title: string; category: string; published: boolean }[]>('/api/v1/articles/admin', {}, userId),
  createArticleAdmin: (userId: string, body: object) => req('/api/v1/articles/admin', { method: 'POST', body: JSON.stringify(body) }, userId),
  updateArticleAdmin: (userId: string, slug: string, body: object) => req(`/api/v1/articles/admin/${slug}`, { method: 'PATCH', body: JSON.stringify(body) }, userId),
  deleteArticleAdmin: (userId: string, slug: string) => req(`/api/v1/articles/admin/${slug}`, { method: 'DELETE' }, userId),
  checklistTemplateVersions: (userId: string, projectId: string, tplId: string) => req<{ version: number; name: string; at: string }[]>(`/api/v1/projects/${projectId}/checklist-templates/${tplId}/versions`, {}, userId),
  userChecklistVersions: (userId: string, tplId: string) => req<{ version: number; name: string; at: string }[]>(`/api/v1/checklist-templates/${tplId}/versions`, {}, userId),
  listProjectChecklists: (userId: string, projectId: string) => req<{ id: string; name: string; items: string[] }[]>(`/api/v1/projects/${projectId}/checklist-templates`, {}, userId),
  saveProjectChecklist: (userId: string, projectId: string, name: string, items: string[]) => req(`/api/v1/projects/${projectId}/checklist-templates`, { method: 'POST', body: JSON.stringify({ name, items }) }, userId),
  listChecklistTemplates: (userId: string) => req<{ id: string; name: string; items: string[] }[]>('/api/v1/checklist-templates', {}, userId),
  saveChecklistTemplate: (userId: string, name: string, items: string[]) => req('/api/v1/checklist-templates', { method: 'POST', body: JSON.stringify({ name, items }) }, userId),
  checklistDiff: (userId: string, projectId: string, tplId: string, v1?: number, v2?: number) => req<{ added: string[]; removed: string[] }>(`/api/v1/projects/${projectId}/checklist-templates/${tplId}/diff?v1=${v1||1}&v2=${v2||2}`, {}, userId),
};
