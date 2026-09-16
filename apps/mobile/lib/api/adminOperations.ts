import { req } from './client';

export type ProviderReconciliationItem = {
  id: string;
  provider: string;
  operation_type: string;
  resource_type: string;
  resource_id: string;
  status: string;
  provider_status?: string | null;
  attempts: number;
  error_code?: string | null;
  error_fingerprint?: string | null;
  next_attempt_at?: string | null;
  last_attempt_at?: string | null;
  completed_at?: string | null;
  updated_at?: string | null;
  recoverable: boolean;
};

export type ProviderReconciliationIndex = {
  total: number;
  limit: number;
  offset: number;
  items: ProviderReconciliationItem[];
};

export type SubscriptionRefundReview = {
  id: string;
  checkout_id?: string | null;
  user_id?: string | null;
  provider_refund_id?: string | null;
  provider_payment_id?: string | null;
  amount: number;
  currency: string;
  status: string;
  reason?: string | null;
  entitlement_changed?: boolean;
  review_status: string;
  effective_review_status: string;
  review_owner_id?: string | null;
  review_version: number;
  resolution?: string | null;
  resolution_note?: string | null;
  created_at?: string | null;
};

export type SubscriptionRefundReviewIndex = {
  items: SubscriptionRefundReview[];
  total: number;
  limit: number;
  offset: number;
  status: string;
};

export type SubscriptionRefundResolutionAction =
  | 'dismiss_not_subscription'
  | 'dismiss_duplicate'
  | 'link_and_apply';

export const adminOperationsApi = {
  listProviderReconciliations: (
    userId: string,
    options: { status?: string; provider?: string; limit?: number; offset?: number } = {},
  ) => {
    const params = new URLSearchParams();
    if (options.status) params.set('status', options.status);
    if (options.provider) params.set('provider', options.provider);
    params.set('limit', String(Math.max(1, Math.min(options.limit ?? 50, 100))));
    params.set('offset', String(Math.max(0, options.offset ?? 0)));
    return req<ProviderReconciliationIndex>(
      `/api/v1/admin/provider-reconciliations?${params.toString()}`,
      {},
      userId,
    );
  },
  requeueProviderReconciliation: (userId: string, reconciliationId: string) =>
    req<ProviderReconciliationItem>(
      `/api/v1/admin/provider-reconciliations/${encodeURIComponent(reconciliationId)}/requeue`,
      { method: 'POST' },
      userId,
    ),
  listSubscriptionRefundReviews: (
    userId: string,
    status: 'actionable' | 'open' | 'claimed' | 'resolved' | 'all' = 'actionable',
  ) =>
    req<SubscriptionRefundReviewIndex>(
      `/api/v1/admin/subscription-refunds/reviews?status=${encodeURIComponent(status)}&limit=100&offset=0`,
      {},
      userId,
    ),
  claimSubscriptionRefundReview: (userId: string, refundId: string, expectedVersion: number) =>
    req<SubscriptionRefundReview>(
      `/api/v1/admin/subscription-refunds/reviews/${encodeURIComponent(refundId)}/claim`,
      { method: 'POST', body: JSON.stringify({ expected_version: expectedVersion }) },
      userId,
    ),
  releaseSubscriptionRefundReview: (userId: string, refundId: string, expectedVersion: number) =>
    req<SubscriptionRefundReview>(
      `/api/v1/admin/subscription-refunds/reviews/${encodeURIComponent(refundId)}/release`,
      { method: 'POST', body: JSON.stringify({ expected_version: expectedVersion }) },
      userId,
    ),
  resolveSubscriptionRefundReview: (
    userId: string,
    refundId: string,
    body: {
      expectedVersion: number;
      action: SubscriptionRefundResolutionAction;
      note: string;
      checkoutId?: string | null;
      decisionKey: string;
    },
  ) =>
    req<SubscriptionRefundReview>(
      `/api/v1/admin/subscription-refunds/reviews/${encodeURIComponent(refundId)}/resolve`,
      {
        method: 'POST',
        body: JSON.stringify({
          expected_version: body.expectedVersion,
          decision_key: body.decisionKey,
          action: body.action,
          note: body.note,
          checkout_id: body.checkoutId ?? null,
        }),
      },
      userId,
    ),
};
