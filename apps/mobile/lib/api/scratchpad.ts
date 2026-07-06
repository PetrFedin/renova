/** API: черновик проекта */
import { req } from './client';
import type { ScratchpadData, ScratchpadLine } from './types/scratchpad';

export const scratchpadApi = {
  /** Свежие данные без HTTP-кэша — список меняется при каждой записи. */
  listScratchpad: (userId: string, projectId: string) =>
    req<ScratchpadData>(`/api/v1/projects/${projectId}/scratchpad`, {}, userId),

  createScratchpadLine: (userId: string, projectId: string, text: string) =>
    req<ScratchpadLine>(`/api/v1/projects/${projectId}/scratchpad`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }, userId),

  patchScratchpadLine: (userId: string, projectId: string, lineId: string, body: object) =>
    req<ScratchpadLine>(`/api/v1/projects/${projectId}/scratchpad/${lineId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }, userId),

  deleteScratchpadLine: (userId: string, projectId: string, lineId: string) =>
    req<{ ok: boolean }>(`/api/v1/projects/${projectId}/scratchpad/${lineId}`, { method: 'DELETE' }, userId),
};
