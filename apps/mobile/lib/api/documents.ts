/** API: Document Center (+ OCR / e-sign Wave 3d) */
import { req } from './client';
import type { ProjectDocumentsResponse } from './types';

export type EsignProvider = {
  name: string;
  display_name: string;
  available: boolean;
};

export const documentsApi = {
  listProjectDocuments: (userId: string, projectId: string) =>
    req<ProjectDocumentsResponse>(`/api/v1/projects/${projectId}/documents`, {}, userId),

  listEsignProviders: (userId: string) =>
    req<{ providers: EsignProvider[] }>('/api/v1/esign/providers', {}, userId),

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

  signProjectDocument: (
    userId: string,
    projectId: string,
    documentId: string,
    opts?: { provider?: string; signature_type?: string },
  ) =>
    req(`/api/v1/projects/${projectId}/documents/${documentId}/sign`, {
      method: 'POST',
      body: JSON.stringify({
        signature_type: opts?.signature_type || opts?.provider || 'in_app',
        provider: opts?.provider || 'in_app',
      }),
    }, userId),

  getDocumentOcr: (userId: string, projectId: string, documentId: string) =>
    req<{ document_id: string; document_type: string; ocr: Record<string, unknown> }>(
      `/api/v1/projects/${projectId}/documents/${documentId}/ocr`,
      {},
      userId,
    ),

  runDocumentOcr: (
    userId: string,
    projectId: string,
    documentId: string,
    applyType = true,
  ) =>
    req(`/api/v1/projects/${projectId}/documents/${documentId}/ocr`, {
      method: 'POST',
      body: JSON.stringify({ apply_type: applyType }),
    }, userId),

  setDocumentLegalHold: (
    userId: string,
    projectId: string,
    documentId: string,
    enabled: boolean,
    retentionUntil?: string | null,
  ) =>
    req(`/api/v1/projects/${projectId}/documents/${documentId}/legal-hold`, {
      method: 'POST',
      body: JSON.stringify({ enabled, retention_until: retentionUntil ?? null }),
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

  tickOcrWorker: (userId: string) =>
    req('/api/v1/ocr/worker/tick', { method: 'POST', body: '{}' }, userId),
};
