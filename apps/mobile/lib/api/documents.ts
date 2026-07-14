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
  uploadProjectDocument: async (
    userId: string,
    projectId: string,
    file: { uri: string; name: string; type: string },
    fields?: { title?: string; document_type?: string; notes?: string },
  ) => {
    const form = new FormData();
    form.append('file', file as unknown as Blob);
    if (fields?.title) form.append('title', fields.title);
    if (fields?.document_type) form.append('document_type', fields.document_type);
    if (fields?.notes) form.append('notes', fields.notes);
    return req(`/api/v1/projects/${projectId}/documents/upload`, {
      method: 'POST',
      body: form as unknown as BodyInit,
      // let fetch set multipart boundary — omit Content-Type JSON
    } as RequestInit, userId);
  },

  restoreProjectDocument: (userId: string, projectId: string, documentId: string) =>
    req(`/api/v1/projects/${projectId}/documents/${documentId}/restore`, {
      method: 'POST',
      body: '{}',
    }, userId),

  deleteProjectDocument: (userId: string, projectId: string, documentId: string) =>
    req(`/api/v1/projects/${projectId}/documents/${documentId}`, {
      method: 'DELETE',
    }, userId),
};
