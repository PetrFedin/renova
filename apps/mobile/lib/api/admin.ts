/** API: admin */
import { req } from './client';

export type OutboxClaimState = 'unclaimed' | 'claimed_self' | 'claimed' | 'expired';

export type OutboxDeadLetter = {
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  created_at: string;
  attempts: number;
  max_attempts: number;
  error_code: string | null;
  error_fingerprint: string | null;
  payload_size_bytes: number;
  claim_state: OutboxClaimState;
  claim_owner: 'self' | 'other' | null;
  claim_expires_at: string | null;
  replayable: boolean;
};

export type OutboxDeadLetterIndex = {
  total: number;
  limit: number;
  offset: number;
  items: OutboxDeadLetter[];
};

export type OutboxDeadLetterClaim = {
  claim_token: string;
  claim_expires_at: string;
  replayed: boolean;
};

export type OutboxDeadLetterReplay = {
  id: string;
  requeued: boolean;
  dispatch: { status: string; attempts?: number };
};

export type OutboxDeadLetterHistoryItem = {
  actor_user_id: string | null;
  action: string;
  status_code: number;
  created_at: string;
};

function deadLetterPath(outboxId: string, action?: string): string {
  const base = `/api/v1/admin/outbox/dead-letters/${encodeURIComponent(outboxId)}`;
  return action ? `${base}/${action}` : base;
}

export const adminApi = {
  linkMoyNalog: (userId: string) => req<{ linked: boolean; message: string; mode?: string; status?: string }>('/api/v1/fns/moy-nalog/link', { method: 'POST' }, userId),
  unlinkMoyNalog: (userId: string) => req<{ linked: boolean; message: string; mode?: string; status?: string }>('/api/v1/fns/moy-nalog/unlink', { method: 'POST' }, userId),
  moyNalogOAuthStart: (userId: string) =>
    req<{ status: string; oauth_ready: boolean; state?: string | null; auth_url?: string | null; message: string }>(
      '/api/v1/fns/moy-nalog/oauth/start',
      { method: 'POST' },
      userId,
    ),
  moyNalogOAuthCallback: (
    userId: string,
    body: { state: string; code?: string | null; demo_complete?: boolean },
  ) =>
    req<{ linked: boolean; message: string; mode?: string; status?: string }>(
      '/api/v1/fns/moy-nalog/oauth/callback',
      { method: 'POST', body: JSON.stringify(body) },
      userId,
    ),
  checkNpd: (inn: string) => req('/api/v1/fns/check-npd', { method: 'POST', body: JSON.stringify({ inn }) }),
  verifyNpdMe: (userId: string, inn: string) => req<{ is_npd: boolean; message: string; badge: string }>('/api/v1/fns/verify-me', { method: 'POST', body: JSON.stringify({ inn }) }, userId),
  setMemberRole: (userId: string, memberId: string, role: string) => req('/api/v1/teams/member-role', { method: 'PATCH', body: JSON.stringify({ user_id: memberId, role }) }, userId),
  joinTeam: (userId: string, token: string) => req('/api/v1/teams/join', { method: 'POST', body: JSON.stringify({ token }) }, userId),
  getRevenueChart: (userId: string) => req<any[]>('/api/v1/admin/revenue-chart', {}, userId),
  getReleaseHealth: (userId: string) => req<any>('/api/v1/admin/release-health', {}, userId),
  getH0Readiness: (userId: string) =>
    req<{
      environment: string;
      ready_for_investor_demo: boolean;
      score: number;
      hint: string;
      blockers: { id: string; label: string; ok: boolean; how: string }[];
      checks: { id: string; label: string; ok: boolean; how: string }[];
    }>('/api/v1/admin/h0-readiness', {}, userId),
  getEsignHealth: (userId: string) => req<{
    kontur_mode: string; kontur_configured: boolean; live_webhook_ready: boolean;
    esign_webhook_secret_set: boolean; hint: string | null;
  }>('/api/v1/esign/health', {}, userId),
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
  listOutboxDeadLetters: (
    userId: string,
    options: { limit?: number; offset?: number; eventType?: string } = {},
  ) => {
    const limit = Math.max(1, Math.min(options.limit ?? 50, 100));
    const offset = Math.max(0, options.offset ?? 0);
    const params = [`limit=${limit}`, `offset=${offset}`];
    if (options.eventType?.trim()) params.push(`event_type=${encodeURIComponent(options.eventType.trim())}`);
    return req<OutboxDeadLetterIndex>(`/api/v1/admin/outbox/dead-letters?${params.join('&')}`, {}, userId);
  },
  getOutboxDeadLetter: (userId: string, outboxId: string) =>
    req<OutboxDeadLetter>(deadLetterPath(outboxId), {}, userId),
  claimOutboxDeadLetter: (userId: string, outboxId: string) =>
    req<OutboxDeadLetterClaim>(deadLetterPath(outboxId, 'claim'), { method: 'POST' }, userId),
  releaseOutboxDeadLetter: (userId: string, outboxId: string, claimToken: string) =>
    req<{ released: boolean; id: string }>(
      deadLetterPath(outboxId, 'release'),
      { method: 'POST', body: JSON.stringify({ claim_token: claimToken }) },
      userId,
    ),
  replayOutboxDeadLetter: (
    userId: string,
    outboxId: string,
    claimToken: string,
    dispatchNow = true,
  ) =>
    req<OutboxDeadLetterReplay>(
      deadLetterPath(outboxId, 'replay'),
      {
        method: 'POST',
        body: JSON.stringify({ claim_token: claimToken, dispatch_now: dispatchNow }),
      },
      userId,
    ),
  getOutboxDeadLetterHistory: (userId: string, outboxId: string, limit = 50) =>
    req<{ items: OutboxDeadLetterHistoryItem[] }>(
      `${deadLetterPath(outboxId, 'history')}?limit=${Math.max(1, Math.min(limit, 100))}`,
      {},
      userId,
    ),
  getUploadUrl: (userId: string) => req<any>('/api/v1/media/upload-url', { method: 'POST' }, userId),
  getMediaUploadUrl: (userId: string) => req<{ key: string; upload_url: string; public_url: string }>('/api/v1/media/upload-url', { method: 'POST' }, userId),
  createTeamInviteLink: (userId: string, role = 'member') =>
    req<{ token: string; link: string }>('/api/v1/teams/invite-link', { method: 'POST', body: JSON.stringify({ role }) }, userId),
  inviteTeamMember: (userId: string, phone: string, role = 'member') => req('/api/v1/teams/invite', { method: 'POST', body: JSON.stringify({ phone, role }) }, userId),
  getAuditLogs: (userId: string) => req<{ id: string; method: string; path: string; status_code: number; created_at: string }[]>('/api/v1/audit/logs', {}, userId),
  getTeam: (userId: string) => req<{ id: string; name: string; members: { user_id: string; phone: string; role: string }[] } | null>('/api/v1/teams/me', {}, userId),
  createTeam: (userId: string, name: string) => req('/api/v1/teams', { method: 'POST', body: JSON.stringify({ name }) }, userId),
  getSubscription: (userId: string) =>
    req<{
      plan: string;
      status?: string;
      is_pro: boolean;
      is_trial?: boolean;
      trial_available?: boolean;
      trial_days?: number;
      days_left?: number | null;
      price: number;
      free_limit: number;
      payments_mode?: 'live' | 'demo' | 'off';
      expires_at?: string | null;
    }>('/api/v1/subscription/me', {}, userId),
  startProTrial: (userId: string) => req('/api/v1/subscription/start-trial', { method: 'POST' }, userId),
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