/** API: design — W110 submit/create offline (approve уже в очереди) */
import { req, cachedGet, API_BASE, ApiError } from './client';
import { isQueueableWriteError } from './queueableError';
import { createClientRequestId } from '@/lib/clientRequestId';

export const designApi = {
  listDesignPackages: (userId: string, projectId: string) =>
    req<{ id: string; title: string; version: number; file_url?: string | null; status: string }[]>(
      `/api/v1/projects/${projectId}/design-packages`,
      {},
      userId,
    ),
  createDesignPackage: async (userId: string, projectId: string, body: object) => {
    // Same client_request_id and exact serialized body is sent on the first
    // attempt and on every offline replay so a lost response cannot mint a
    // second DesignPackage/version (#413, following the #316/#398 pattern).
    const requestBody = JSON.stringify({ ...body, client_request_id: createClientRequestId('design-package') });
    try {
      return await req(`/api/v1/projects/${projectId}/design-packages`, {
        method: 'POST',
        body: requestBody,
      }, userId);
    } catch (e) {
      if (!isQueueableWriteError(e)) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({
        path: `/api/v1/projects/${projectId}/design-packages`,
        method: 'POST',
        body: requestBody,
        userId,
      });
      throw new Error('offline_queued');
    }
  },
  submitDesignPackage: async (userId: string, projectId: string, id: string) => {
    try {
      return await req(`/api/v1/projects/${projectId}/design-packages/${id}/submit`, { method: 'POST' }, userId);
    } catch (e) {
      if (!isQueueableWriteError(e)) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({
        path: `/api/v1/projects/${projectId}/design-packages/${id}/submit`,
        method: 'POST',
        body: '{}',
        userId,
      });
      throw new Error('offline_queued');
    }
  },
  approveDesignPackage: async (userId: string, projectId: string, id: string) => {
    try {
      return await req(`/api/v1/projects/${projectId}/design-packages/${id}/approve`, { method: 'POST' }, userId);
    } catch (e) {
      if (!isQueueableWriteError(e)) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({
        path: `/api/v1/projects/${projectId}/design-packages/${id}/approve`,
        method: 'POST',
        body: '{}',
        userId,
      });
      throw new Error('offline_queued');
    }
  },
  designDiff: (userId: string, projectId: string, v1?: number, v2?: number) =>
    req(`/api/v1/projects/${projectId}/design-packages/diff?v1=${v1 || 1}&v2=${v2 || 2}`, {}, userId),
};
