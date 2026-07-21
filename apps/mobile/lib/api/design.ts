/** API: design — W110 submit/create offline (approve уже в очереди) */
import { req, cachedGet, API_BASE, ApiError } from './client';

export const designApi = {
  listDesignPackages: (userId: string, projectId: string) =>
    req<{ id: string; title: string; version: number; file_url?: string | null; status: string }[]>(
      `/api/v1/projects/${projectId}/design-packages`,
      {},
      userId,
    ),
  createDesignPackage: async (userId: string, projectId: string, body: object) => {
    try {
      return await req(`/api/v1/projects/${projectId}/design-packages`, {
        method: 'POST',
        body: JSON.stringify(body),
      }, userId);
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({
        path: `/api/v1/projects/${projectId}/design-packages`,
        method: 'POST',
        body: JSON.stringify(body),
        userId,
      });
      throw new Error('offline_queued');
    }
  },
  submitDesignPackage: async (userId: string, projectId: string, id: string) => {
    try {
      return await req(`/api/v1/projects/${projectId}/design-packages/${id}/submit`, { method: 'POST' }, userId);
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) throw e;
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
      if (e instanceof ApiError) throw e;
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
