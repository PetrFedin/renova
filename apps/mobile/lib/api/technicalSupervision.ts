import { req } from './client';
import type { ProjectIssue } from './types';

export type TechnicalSupervisionProviderType = 'individual' | 'company';

export type TechnicalSupervisionAssignment = {
  id: string;
  project_id: string;
  provider_type: TechnicalSupervisionProviderType;
  provider_name: string;
  representative_user_id: string;
  representative_full_name?: string | null;
  representative_profile_code?: string | null;
  appointed_by_user_id: string;
  appointed_at?: string | null;
  revoked_at?: string | null;
  revoked_by_user_id?: string | null;
  supersedes_assignment_id?: string | null;
};

export type TechnicalSupervisionStatus = {
  active: TechnicalSupervisionAssignment | null;
  access_mode: string;
  capabilities: string[];
};

export type TechnicalSupervisionMutation = {
  active: TechnicalSupervisionAssignment | null;
  replayed: boolean;
};

export type TechnicalSupervisionAssignmentInput = {
  profile_code: string;
  provider_type: TechnicalSupervisionProviderType;
  provider_name?: string | null;
  expected_assignment_id?: string | null;
};

export type TechnicalQualityIssueInput = {
  title: string;
  description?: string | null;
  room_id?: string | null;
  stage_id?: string | null;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  floor_plan_id?: string | null;
  x_pct?: number | null;
  y_pct?: number | null;
  photo_key?: string | null;
};

export const technicalSupervisionApi = {
  getTechnicalSupervision: (userId: string, projectId: string) =>
    req<TechnicalSupervisionStatus>(
      `/api/v1/projects/${projectId}/technical-supervision`,
      {},
      userId,
    ),
  getTechnicalSupervisionHistory: (userId: string, projectId: string) =>
    req<TechnicalSupervisionAssignment[]>(
      `/api/v1/projects/${projectId}/technical-supervision/history`,
      {},
      userId,
    ),
  setTechnicalSupervision: (
    userId: string,
    projectId: string,
    body: TechnicalSupervisionAssignmentInput,
  ) =>
    req<TechnicalSupervisionMutation>(
      `/api/v1/projects/${projectId}/technical-supervision`,
      { method: 'PUT', body: JSON.stringify(body) },
      userId,
    ),
  revokeTechnicalSupervision: (
    userId: string,
    projectId: string,
    expectedAssignmentId?: string | null,
  ) => {
    const query = expectedAssignmentId
      ? `?expected_assignment_id=${encodeURIComponent(expectedAssignmentId)}`
      : '';
    return req<TechnicalSupervisionMutation>(
      `/api/v1/projects/${projectId}/technical-supervision${query}`,
      { method: 'DELETE' },
      userId,
    );
  },
  createTechnicalQualityIssue: (
    userId: string,
    projectId: string,
    body: TechnicalQualityIssueInput,
  ) =>
    req<ProjectIssue>(
      `/api/v1/projects/${projectId}/technical-supervision/issues`,
      { method: 'POST', body: JSON.stringify(body) },
      userId,
    ),
};
