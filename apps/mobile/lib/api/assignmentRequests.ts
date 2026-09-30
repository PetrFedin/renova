/** API: заявки исполнителя на ведение объекта (подтверждает заказчик) */
import { req } from './client';
import type { ProjectDetail } from './types';

export type AssignmentRequestStatus = 'pending' | 'accepted' | 'declined' | 'superseded';

export type AssignmentRequest = {
  id: string;
  project_id: string;
  contractor_id: string;
  status: AssignmentRequestStatus;
  message?: string | null;
  created_at?: string | null;
  resolved_at?: string | null;
  /** Только в списке заказчика */
  contractor_name?: string;
  /** Только в «моих заявках» исполнителя */
  project_name?: string;
};

export type ClaimResult = {
  status: 'pending_customer_confirmation' | 'assigned';
  created?: boolean;
  request: AssignmentRequest | null;
};

export const assignmentRequestsApi = {
  /** Исполнитель заявляет желание вести объект — назначения НЕ происходит. */
  claimProject: (userId: string, projectId: string) =>
    req<ClaimResult>(`/api/v1/projects/${projectId}/assign`, { method: 'POST' }, userId),
  claimProjectByCode: (userId: string, code: string) =>
    req<ClaimResult>('/api/v1/projects/join-by-code/claim', { method: 'POST', body: JSON.stringify({ code }) }, userId),
  listMyAssignmentRequests: (userId: string) =>
    req<{ items: AssignmentRequest[] }>('/api/v1/projects/me/assignment-requests', {}, userId),
  listAssignmentRequests: (userId: string, projectId: string) =>
    req<{ items: AssignmentRequest[] }>(`/api/v1/projects/${projectId}/assignment-requests`, {}, userId),
  acceptAssignmentRequest: (userId: string, projectId: string, requestId: string) =>
    req<{ status: 'accepted'; request: AssignmentRequest; project: ProjectDetail }>(
      `/api/v1/projects/${projectId}/assignment-requests/${requestId}/accept`, { method: 'POST' }, userId),
  declineAssignmentRequest: (userId: string, projectId: string, requestId: string) =>
    req<{ status: 'declined'; request: AssignmentRequest }>(
      `/api/v1/projects/${projectId}/assignment-requests/${requestId}/decline`, { method: 'POST' }, userId),
  /** Заказчик снимает исполнителя (409 с пояснением, если уже есть работы/подписи). */
  releaseContractor: (userId: string, projectId: string) =>
    req<ProjectDetail>(`/api/v1/projects/${projectId}/contractor`, { method: 'DELETE' }, userId),
};
