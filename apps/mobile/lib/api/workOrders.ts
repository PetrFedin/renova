/** API: workOrders */
import { req, cachedGet, API_BASE } from './client';
import type { WorkAcceptance, WorkOrder } from './types';
export const workOrdersApi = {
  listWorkOrders: (userId: string, projectId: string) => req<WorkOrder[]>(`/api/v1/projects/${projectId}/work-orders`, {}, userId),
  getWorkOrder: (userId: string, projectId: string, workOrderId: string) =>
    req<WorkOrder>(`/api/v1/projects/${projectId}/work-orders/${workOrderId}`, {}, userId),
  createWorkOrder: (userId: string, projectId: string, body: object) =>
    req<WorkOrder>(`/api/v1/projects/${projectId}/work-orders`, { method: 'POST', body: JSON.stringify(body) }, userId),
  patchWorkOrder: (userId: string, projectId: string, workOrderId: string, body: object) =>
    req<WorkOrder>(`/api/v1/projects/${projectId}/work-orders/${workOrderId}`, { method: 'PATCH', body: JSON.stringify(body) }, userId),
  transitionWorkOrder: (userId: string, projectId: string, workOrderId: string, status: string) =>
    req<WorkOrder>(`/api/v1/projects/${projectId}/work-orders/${workOrderId}/transition`, { method: 'POST', body: JSON.stringify({ status }) }, userId),
  listAcceptances: (userId: string, projectId: string, status?: string) => req<WorkAcceptance[]>(`/api/v1/projects/${projectId}/acceptances${status ? `?status=${status}` : ''}`, {}, userId),
  acceptancesPendingCount: (userId: string, projectId: string) =>
    req<{ count: number }>(`/api/v1/projects/${projectId}/acceptances/pending-count`, {}, userId),
  acceptWork: (userId: string, projectId: string, acceptanceId: string, body?: { with_remarks?: boolean; comment?: string }) =>
    req<WorkAcceptance>(`/api/v1/projects/${projectId}/acceptances/${acceptanceId}/accept`, { method: 'POST', body: JSON.stringify(body || {}) }, userId),
  returnWork: (userId: string, projectId: string, acceptanceId: string, comment?: string) =>
    req<WorkAcceptance>(`/api/v1/projects/${projectId}/acceptances/${acceptanceId}/return`, { method: 'POST', body: JSON.stringify({ comment }) }, userId),
};
