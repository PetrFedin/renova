/** API: приглашения в бригаду (MKT-022) и операторские очереди админа (MKT-033). */
import { req } from './client';

export type TeamInvitation = {
  id: string;
  team_id: string;
  team_name: string;
  role: string;
  expires_at: string;
};

/** Действующее приглашение владельца бригады (GET /teams/invites, MKT-012). */
export type OwnerTeamInvite = {
  id: string;
  role: string;
  kind: 'personal' | 'link';
  invitee_user_id: string | null;
  expires_at: string;
};

export type TeamInviteAck = { ok: boolean; status?: string; message?: string };

export type RefundReviewItem = {
  id: string;
  checkout_id: string | null;
  amount: number;
  currency: string;
  status: string;
  reason?: string | null;
  review_status: string;
  effective_review_status: string;
  review_owner_id: string | null;
  review_claim_expires_at: string | null;
  review_version: number;
  resolution: string | null;
  created_at: string | null;
};

export type RefundReviewIndex = { items: RefundReviewItem[]; total: number; limit: number; offset: number };

export type RefundResolveAction = 'dismiss_not_subscription' | 'dismiss_duplicate' | 'link_and_apply';

export type ProviderReconciliation = {
  id: string;
  provider: string;
  operation_type: string;
  resource_type: string;
  status: string;
  provider_status: string | null;
  attempts: number;
  error_code: string | null;
  last_attempt_at: string | null;
  updated_at: string | null;
  recoverable: boolean;
};

export type ProviderReconciliationIndex = {
  items: ProviderReconciliation[];
  total: number;
  limit: number;
  offset: number;
};

const REFUNDS = '/api/v1/admin/subscription-refunds/reviews';

export const teamOpsApi = {
  listTeamInvitations: (userId: string) =>
    req<{ items: TeamInvitation[] }>('/api/v1/teams/invitations', {}, userId),
  listOwnerTeamInvites: (userId: string) =>
    req<{ items: OwnerTeamInvite[] }>('/api/v1/teams/invites', {}, userId),
  revokeOwnerTeamInvite: (userId: string, inviteId: string) =>
    req<{ ok: boolean; id: string }>(`/api/v1/teams/invites/${encodeURIComponent(inviteId)}`, { method: 'DELETE' }, userId),
  respondTeamInvitation: (userId: string, invitationId: string, decision: 'accept' | 'decline') =>
    req<{ ok: boolean; status: string; team_id: string }>(
      `/api/v1/teams/invitations/${encodeURIComponent(invitationId)}/${decision}`,
      { method: 'POST' },
      userId,
    ),
  listRefundReviews: (userId: string, status = 'actionable') =>
    req<RefundReviewIndex>(`${REFUNDS}?status=${encodeURIComponent(status)}&limit=50`, {}, userId),
  claimRefundReview: (userId: string, id: string, expectedVersion: number) =>
    req<RefundReviewItem>(
      `${REFUNDS}/${encodeURIComponent(id)}/claim`,
      { method: 'POST', body: JSON.stringify({ expected_version: expectedVersion }) },
      userId,
    ),
  releaseRefundReview: (userId: string, id: string, expectedVersion: number) =>
    req<RefundReviewItem>(
      `${REFUNDS}/${encodeURIComponent(id)}/release`,
      { method: 'POST', body: JSON.stringify({ expected_version: expectedVersion }) },
      userId,
    ),
  resolveRefundReview: (
    userId: string,
    id: string,
    body: {
      expected_version: number;
      decision_key: string;
      action: RefundResolveAction;
      note: string;
      checkout_id?: string;
    },
  ) =>
    req<RefundReviewItem>(
      `${REFUNDS}/${encodeURIComponent(id)}/resolve`,
      { method: 'POST', body: JSON.stringify(body) },
      userId,
    ),
  listProviderReconciliations: (userId: string, status?: string) =>
    req<ProviderReconciliationIndex>(
      `/api/v1/admin/provider-reconciliations?limit=50${status ? `&status=${encodeURIComponent(status)}` : ''}`,
      {},
      userId,
    ),
  requeueProviderReconciliation: (userId: string, id: string) =>
    req<ProviderReconciliation>(
      `/api/v1/admin/provider-reconciliations/${encodeURIComponent(id)}/requeue`,
      { method: 'POST' },
      userId,
    ),
};
