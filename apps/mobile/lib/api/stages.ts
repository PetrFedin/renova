/** API: stages */
import { req, API_BASE, ApiError } from './client';
import type { ProjectPlan, Stage, StageChecklistItem, StageDetail, WorkAcceptance, WorkCompletionCheck, WorkSnapshot } from './types';

async function activeAcceptance(userId: string, projectId: string, stageId: string): Promise<WorkAcceptance | null> {
  const items = await req<WorkAcceptance[]>(
    `/api/v1/projects/${projectId}/work-acceptances?stage_id=${encodeURIComponent(stageId)}`,
    {},
    userId,
  );
  return items.find((item) => ['requested', 'in_review'].includes(item.status)) ?? null;
}

export const stagesApi = {
  getPlan: (userId: string, projectId: string) => req<ProjectPlan>(`/api/v1/projects/${projectId}/plan`, {}, userId),
  getStage: (userId: string, projectId: string, stageId: string) =>
    req<StageDetail>(`/api/v1/projects/${projectId}/stages/${stageId}`, {}, userId),
  addStageComment: async (userId: string, projectId: string, stageId: string, text: string) => {
    try {
      return await req(`/api/v1/projects/${projectId}/stages/${stageId}/comments`, { method: 'POST', body: JSON.stringify({ text }) }, userId);
    } catch {
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({ path: `/api/v1/projects/${projectId}/stages/${stageId}/comments`, method: 'POST', body: JSON.stringify({ text }), userId });
      throw new Error('offline_queued');
    }
  },
  uploadStagePhoto: async (userId: string, projectId: string, stageId: string, blob: Blob, caption?: string) => {
    const up = await req<{ key: string; upload_url: string | null; public_url: string }>('/api/v1/media/upload-url', { method: 'POST' }, userId);
    if (up.upload_url) {
      await fetch(up.upload_url, { method: 'PUT', body: blob, headers: { 'Content-Type': 'image/jpeg' } });
      return req(`/api/v1/projects/${projectId}/stages/${stageId}/photos`, { method: 'POST', body: JSON.stringify({ image_data: up.public_url, caption }) }, userId);
    }
    return null;
  },
  addStagePhoto: async (userId: string, projectId: string, stageId: string, image_data?: string, caption?: string, storage_key?: string, image_url?: string) => {
    try {
      return await req(`/api/v1/projects/${projectId}/stages/${stageId}/photos`, { method: 'POST', body: JSON.stringify({ image_data, caption, storage_key, image_url }) }, userId);
    } catch {
      if (image_data) {
        const { enqueue } = await import('@/lib/offlineQueue');
        await enqueue({ path: `/api/v1/projects/${projectId}/stages/${stageId}/photos`, method: 'POST', body: JSON.stringify({ image_data, caption }), userId });
        throw new Error('offline_queued');
      }
      throw new Error('offline');
    }
  },
  markStageReady: (userId: string, projectId: string, stageId: string) =>
    req<StageDetail>(`/api/v1/projects/${projectId}/stages/${stageId}/ready`, { method: 'POST' }, userId),
  submitStage: async (userId: string, projectId: string, stageId: string) => {
    try {
      return await req<WorkAcceptance>(
        `/api/v1/projects/${projectId}/work-acceptances`,
        {
          method: 'POST',
          body: JSON.stringify({
            stage_id: stageId,
            checklist: [],
            comment: 'Этап готов к приёмке',
          }),
        },
        userId,
      );
    } catch (error) {
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) throw error;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({
        path: `/api/v1/projects/${projectId}/work-acceptances`,
        method: 'POST',
        body: JSON.stringify({ stage_id: stageId, checklist: [], comment: 'Этап готов к приёмке' }),
        userId,
      });
      throw new Error('offline_queued');
    }
  },
  rejectStage: async (userId: string, projectId: string, stageId: string, text: string) => {
    const acceptance = await activeAcceptance(userId, projectId, stageId);
    if (!acceptance) throw new ApiError(409, 'Нет активной приёмки по этапу', 'acceptance_not_requested');
    const body = { quality_score: 5, comment: text, create_issue: true };
    try {
      return await req(
        `/api/v1/projects/${projectId}/work-acceptances/${acceptance.id}/return`,
        { method: 'POST', body: JSON.stringify(body) },
        userId,
      );
    } catch (error) {
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) throw error;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({
        path: `/api/v1/projects/${projectId}/work-acceptances/${acceptance.id}/return`,
        method: 'POST',
        body: JSON.stringify(body),
        userId,
      });
      throw new Error('offline_queued');
    }
  },
  acceptStage: async (userId: string, projectId: string, stageId: string) => {
    const acceptance = await activeAcceptance(userId, projectId, stageId);
    if (!acceptance) throw new ApiError(409, 'Нет активной приёмки по этапу', 'acceptance_not_requested');
    try {
      return await req(
        `/api/v1/projects/${projectId}/work-acceptances/${acceptance.id}/accept`,
        { method: 'POST', body: JSON.stringify({ quality_score: 10, comment: 'Работы приняты' }) },
        userId,
      );
    } catch (error) {
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) throw error;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({
        path: `/api/v1/projects/${projectId}/work-acceptances/${acceptance.id}/accept`,
        method: 'POST',
        body: JSON.stringify({ quality_score: 10, comment: 'Работы приняты' }),
        userId,
      });
      throw new Error('offline_queued');
    }
  },
  startStage: (userId: string, projectId: string, stageId: string) => req<Stage>(`/api/v1/projects/${projectId}/stages/${stageId}/start`, { method: 'POST' }, userId),
  createStage: (userId: string, projectId: string, body: { name: string; planned_start?: string; planned_end?: string; room_ids?: string[]; work_type?: string }) =>
    req<Stage>(`/api/v1/projects/${projectId}/stages`, { method: 'POST', body: JSON.stringify(body) }, userId),
  workSnapshot: (userId: string, projectId: string, stageId: string) => req<WorkSnapshot>(`/api/v1/projects/${projectId}/stages/${stageId}/snapshot`, {}, userId),
  workCompletionCheck: (userId: string, projectId: string, stageId: string) => req<{ ok: boolean; checks: WorkCompletionCheck[]; failed: WorkCompletionCheck[] }>(`/api/v1/projects/${projectId}/stages/${stageId}/completion-check`, {}, userId),
  stageWorkflow: (userId: string, projectId: string, stageId: string) => req<{ work_type: string; steps: string[]; checklist: StageChecklistItem[]; checklist_progress: number }>(`/api/v1/projects/${projectId}/stages/${stageId}/workflow`, {}, userId),
  toggleStageChecklist: (userId: string, projectId: string, stageId: string, item_id: string, done: boolean) =>
    req(`/api/v1/projects/${projectId}/stages/${stageId}/checklist/toggle`, { method: 'POST', body: JSON.stringify({ item_id, done }) }, userId),
  stageBlocked: (userId: string, projectId: string, stageId: string) => req<{ blocked: boolean; depends_on?: string }>(`/api/v1/projects/${projectId}/stages/${stageId}/blocked`, {}, userId),
  patchStageRooms: (userId: string, projectId: string, stageId: string, roomIds: string[]) =>
    req(`/api/v1/projects/${projectId}/stages/${stageId}/rooms`, { method: 'PATCH', body: JSON.stringify({ room_ids: roomIds }) }, userId),
  patchStageDepends: (userId: string, projectId: string, stageId: string, dependsOn: string | null) => req(`/api/v1/projects/${projectId}/stages/${stageId}/depends`, { method: 'PATCH', body: JSON.stringify({ depends_on_stage_id: dependsOn }) }, userId),
  patchStageWorkType: (userId: string, projectId: string, stageId: string, work_type: string | null) => req(`/api/v1/projects/${projectId}/stages/${stageId}/work-type`, { method: 'PATCH', body: JSON.stringify({ work_type }) }, userId),
  reactionCounts: (userId: string, projectId: string, stageId: string) => req<Record<string, Record<string, number>>>(`/api/v1/projects/${projectId}/stages/${stageId}/reaction-counts`, {}, userId),
  reactComment: (userId: string, projectId: string, stageId: string, commentId: string, reaction: string) => req(`/api/v1/projects/${projectId}/stages/${stageId}/comments/${commentId}/react`, { method: 'POST', body: JSON.stringify({ reaction }) }, userId),
  getCommentReactions: (userId: string, projectId: string, stageId: string, commentId: string) => req<{ reactions: { user_id: string; reaction: string }[] }>(`/api/v1/projects/${projectId}/stages/${stageId}/comments/${commentId}/react`, {}, userId),
  exportStageAcceptance: async (userId: string, projectId: string, stageId: string, checklist?: string[]) => {
    const qs = checklist?.length ? `?checks=${encodeURIComponent(checklist.join('|'))}` : '';
    const { downloadApiPath } = await import('@/lib/downloadFile');
    await downloadApiPath(
      userId,
      `/api/v1/projects/${projectId}/stages/${stageId}/acceptance.pdf${qs}`,
      `acceptance-${stageId.slice(0, 8)}.pdf`,
    );
  },
  extendReworkSla: (userId: string, projectId: string, stageId: string, days = 1) => req(`/api/v1/projects/${projectId}/rework-sla/extend?stage_id=${stageId}&days=${days}`, { method: 'POST' }, userId),
  reworkSlaCheck: (userId: string, projectId: string) => req(`/api/v1/projects/${projectId}/rework-sla/check`, { method: 'POST' }, userId),
};
