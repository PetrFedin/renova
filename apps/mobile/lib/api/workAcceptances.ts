/** API: приёмка работ */
import { req } from './client';
import type { WorkAcceptance } from './types';

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
  requestWorkAcceptance: (userId: string, projectId: string, body: WorkAcceptanceCreateIn) => req<WorkAcceptance>(
    `/api/v1/projects/${projectId}/work-acceptances`,
    { method: 'POST', body: JSON.stringify(body) },
    userId,
  ),
  acceptWork: (userId: string, projectId: string, acceptanceId: string, body: WorkAcceptanceDecisionIn = {}) => req<WorkAcceptance>(
    `/api/v1/projects/${projectId}/work-acceptances/${acceptanceId}/accept`,
    { method: 'POST', body: JSON.stringify(body) },
    userId,
  ),
  returnWork: (userId: string, projectId: string, acceptanceId: string, body: WorkAcceptanceDecisionIn = {}) => req<WorkAcceptance>(
    `/api/v1/projects/${projectId}/work-acceptances/${acceptanceId}/return`,
    { method: 'POST', body: JSON.stringify(body) },
    userId,
  ),
};
