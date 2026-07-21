/** API: приёмка работ */
import { req, ApiError } from './client';
import type { WorkAcceptance } from './types';
import { acceptanceDecisionBody } from '@/lib/acceptanceDecide';

export type WorkAcceptanceCreateIn = {
  stage_id: string;
  checklist?: string[];
  comment?: string;
};

export type WorkAcceptanceDecisionIn = {
  checklist?: string[];
  quality_score?: number;
  comment?: string;
  create_issue?: boolean;
};

export const workAcceptancesApi = {
  listWorkAcceptances: (userId: string, projectId: string, stageId?: string) => {
    const query = stageId ? `?stage_id=${encodeURIComponent(stageId)}` : '';
    return req<WorkAcceptance[]>(`/api/v1/projects/${projectId}/work-acceptances${query}`, {}, userId);
  },
  /** Canonical pending count (replaces legacy /acceptances/pending-count). */
  acceptancesPendingCount: (userId: string, projectId: string) =>
    req<{ count: number }>(`/api/v1/projects/${projectId}/work-acceptances/pending-count`, {}, userId),
  requestWorkAcceptance: async (userId: string, projectId: string, body: WorkAcceptanceCreateIn) => {
    try {
      return await req<WorkAcceptance>(
        `/api/v1/projects/${projectId}/work-acceptances`,
        { method: 'POST', body: JSON.stringify(body) },
        userId,
      );
    } catch (error) {
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) throw error;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({
        path: `/api/v1/projects/${projectId}/work-acceptances`,
        method: 'POST',
        body: JSON.stringify(body),
        userId,
      });
      throw new Error('offline_queued');
    }
  },
  acceptWork: async (userId: string, projectId: string, acceptanceId: string, body: WorkAcceptanceDecisionIn = {}) => {
    const safe = {
      ...acceptanceDecisionBody({
        qualityScore: body.quality_score,
        comment: body.comment,
        createIssue: body.create_issue,
      }),
      ...(body.checklist ? { checklist: body.checklist } : {}),
    };
    try {
      return await req<WorkAcceptance>(
        `/api/v1/projects/${projectId}/work-acceptances/${acceptanceId}/accept`,
        { method: 'POST', body: JSON.stringify(safe) },
        userId,
      );
    } catch (error) {
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) throw error;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({
        path: `/api/v1/projects/${projectId}/work-acceptances/${acceptanceId}/accept`,
        method: 'POST',
        body: JSON.stringify(safe),
        userId,
      });
      throw new Error('offline_queued');
    }
  },
  returnWork: async (userId: string, projectId: string, acceptanceId: string, body: WorkAcceptanceDecisionIn = {}) => {
    const safe = {
      ...acceptanceDecisionBody({
        qualityScore: body.quality_score,
        comment: body.comment,
        createIssue: body.create_issue,
      }),
      ...(body.checklist ? { checklist: body.checklist } : {}),
    };
    try {
      return await req<WorkAcceptance>(
        `/api/v1/projects/${projectId}/work-acceptances/${acceptanceId}/return`,
        { method: 'POST', body: JSON.stringify(safe) },
        userId,
      );
    } catch (error) {
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) throw error;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({
        path: `/api/v1/projects/${projectId}/work-acceptances/${acceptanceId}/return`,
        method: 'POST',
        body: JSON.stringify(safe),
        userId,
      });
      throw new Error('offline_queued');
    }
  },
};
