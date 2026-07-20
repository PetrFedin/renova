/** API: черновик проекта — W111 offline queue (полевые заметки) */
import { req, ApiError } from './client';
import type { ScratchpadData, ScratchpadLine } from './types/scratchpad';

export const scratchpadApi = {
  /** Свежие данные без HTTP-кэша — список меняется при каждой записи. */
  listScratchpad: (userId: string, projectId: string) =>
    req<ScratchpadData>(`/api/v1/projects/${projectId}/scratchpad`, {}, userId),

  createScratchpadLine: async (userId: string, projectId: string, text: string) => {
    try {
      return await req<ScratchpadLine>(`/api/v1/projects/${projectId}/scratchpad`, {
        method: 'POST',
        body: JSON.stringify({ text }),
      }, userId);
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({
        path: `/api/v1/projects/${projectId}/scratchpad`,
        method: 'POST',
        body: JSON.stringify({ text }),
        userId,
      });
      throw new Error('offline_queued');
    }
  },

  patchScratchpadLine: async (userId: string, projectId: string, lineId: string, body: object) => {
    try {
      return await req<ScratchpadLine>(`/api/v1/projects/${projectId}/scratchpad/${lineId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }, userId);
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({
        path: `/api/v1/projects/${projectId}/scratchpad/${lineId}`,
        method: 'PATCH',
        body: JSON.stringify(body),
        userId,
      });
      throw new Error('offline_queued');
    }
  },

  deleteScratchpadLine: async (userId: string, projectId: string, lineId: string) => {
    try {
      return await req<{ ok: boolean }>(`/api/v1/projects/${projectId}/scratchpad/${lineId}`, {
        method: 'DELETE',
      }, userId);
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({
        path: `/api/v1/projects/${projectId}/scratchpad/${lineId}`,
        method: 'DELETE',
        body: '{}',
        userId,
      });
      throw new Error('offline_queued');
    }
  },
};
