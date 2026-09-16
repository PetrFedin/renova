/** API: Document Center (+ OCR / e-sign Wave 3d) */
import { req, ApiError } from './client';
import { shouldQueueReplaySafeMutation } from './failurePolicy';
import { createClientRequestId } from '@/lib/clientRequestId';
import { OFFLINE_UPLOAD_BLOCKED } from '@/lib/offlineErrors';
import type { ProjectDocumentsResponse } from './types';

export type EsignProvider = {
  name: string;
  display_name: string;
  available: boolean;
};

type ProjectDocumentCreateInput = {
  title: string;
  document_type?: string;
  stage_id?: string | null;
  payment_id?: string | null;
  notes?: string | null;
  href?: string | null;
  storage_key?: string | null;
  mime_type?: string | null;
  file_size?: number | null;
  checksum_sha256?: string | null;
  client_request_id?: string;
};

type ProjectDocumentUploadFields = {
  title?: string;
  document_type?: string;
  notes?: string;
  stage_id?: string;
  payment_id?: string;
  /** Retain this only when a caller deliberately retries the same selected file command. */
  client_request_id?: string;
};

export const documentsApi = {
  listProjectDocuments: (userId: string, projectId: string) =>
    req<ProjectDocumentsResponse>(`/api/v1/projects/${projectId}/documents`, {}, userId),

  listEsignProviders: (userId: string) =>
    req<{ providers: EsignProvider[] }>('/api/v1/esign/providers', {}, userId),

  createProjectDocument: async (
    userId: string,
    projectId: string,
    body: ProjectDocumentCreateInput,
  ) => {
    const requestBody = {
      ...body,
      client_request_id: body.client_request_id ?? createClientRequestId('document'),
    };
    const payload = JSON.stringify(requestBody);
    const path = `/api/v1/projects/${projectId}/documents`;
    try {
      return await req(path, { method: 'POST', body: payload }, userId);
    } catch (error) {
      if (!shouldQueueReplaySafeMutation(error)) throw error;
      // Binary/data payloads stay fail-closed. Only pure metadata is durable in
      // the JSON offline queue; uploads have a separate storage recovery path.
      if (body.storage_key || body.href?.startsWith('data:')) {
        throw new Error(OFFLINE_UPLOAD_BLOCKED);
      }
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({ path, method: 'POST', body: payload, userId });
      throw new Error('offline_queued');
    }
  },

  signProjectDocument: async (
    userId: string,
    projectId: string,
    documentId: string,
    opts?: { provider?: string; signature_type?: string },
  ) => {
    const body = JSON.stringify({
      signature_type: opts?.signature_type || opts?.provider || 'in_app',
      provider: opts?.provider || 'in_app',
    });
    try {
      return await req(`/api/v1/projects/${projectId}/documents/${documentId}/sign`, {
        method: 'POST',
        body,
      }, userId);
    } catch (e) {
      if (e instanceof ApiError) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({
        path: `/api/v1/projects/${projectId}/documents/${documentId}/sign`,
        method: 'POST',
        body,
        userId,
      });
      throw new Error('offline_queued');
    }
  },

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

  archiveProjectDocument: async (userId: string, projectId: string, documentId: string) => {
    try {
      return await req(`/api/v1/projects/${projectId}/documents/${documentId}/archive`, {
        method: 'POST',
        body: '{}',
      }, userId);
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({
        path: `/api/v1/projects/${projectId}/documents/${documentId}/archive`,
        method: 'POST',
        body: '{}',
        userId,
      });
      throw new Error('offline_queued');
    }
  },

  uploadProjectDocument: async (
    userId: string,
    projectId: string,
    file: { uri: string; name: string; type: string },
    fields?: ProjectDocumentUploadFields,
  ) => {
    const requestId = fields?.client_request_id ?? createClientRequestId('document-upload');
    const path = `/api/v1/projects/${projectId}/documents/upload`;
    const buildForm = () => {
      const form = new FormData();
      form.append('file', file as unknown as Blob);
      if (fields?.title) form.append('title', fields.title);
      if (fields?.document_type) form.append('document_type', fields.document_type);
      if (fields?.notes) form.append('notes', fields.notes);
      if (fields?.stage_id) form.append('stage_id', fields.stage_id);
      if (fields?.payment_id) form.append('payment_id', fields.payment_id);
      form.append('client_request_id', requestId);
      return form;
    };
    const send = () => req(path, {
      method: 'POST',
      body: buildForm() as unknown as BodyInit,
    } as RequestInit, userId);

    try {
      return await send();
    } catch (firstError) {
      if (!shouldQueueReplaySafeMutation(firstError)) throw firstError;
      // Bounded response-loss recovery: the backend maps this exact request ID
      // and content checksum to one document/blob, so one immediate replay is safe.
      try {
        return await send();
      } catch (retryError) {
        if (!shouldQueueReplaySafeMutation(retryError)) throw retryError;
        // Binary bodies are never persisted in the JSON offline queue.
        throw new Error(OFFLINE_UPLOAD_BLOCKED);
      }
    }
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