/** API: Document Center (+ canonical CRUD D-01…D-06) */
import { req } from './client';
import type { ProjectDocumentsResponse } from './types';

export const documentsApi = {
  listProjectDocuments: (userId: string, projectId: string) =>
    req<ProjectDocumentsResponse>(`/api/v1/projects/${projectId}/documents`, {}, userId),

  createProjectDocument: (
    userId: string,
    projectId: string,
    body: {
      title: string;
      document_type?: string;
      stage_id?: string | null;
      payment_id?: string | null;
      notes?: string | null;
      href?: string | null;
      storage_key?: string | null;
      mime_type?: string | null;
    },
  ) =>
    req(`/api/v1/projects/${projectId}/documents`, {
      method: 'POST',
      body: JSON.stringify(body),
    }, userId),

  signProjectDocument: (userId: string, projectId: string, documentId: string) =>
    req(`/api/v1/projects/${projectId}/documents/${documentId}/sign`, {
      method: 'POST',
      body: JSON.stringify({ signature_type: 'in_app' }),
    }, userId),

  archiveProjectDocument: (userId: string, projectId: string, documentId: string) =>
    req(`/api/v1/projects/${projectId}/documents/${documentId}/archive`, {
      method: 'POST',
      body: '{}',
    }, userId),
};
