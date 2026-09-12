/**
 * Replay-safe production composition for stage comments.
 *
 * Keep the legacy stage API surface intact while overriding only the create
 * mutation whose server side now owns a stable ClientWriteRequest identity.
 * This avoids broad transport-policy changes before #317.
 */
import { stagesApi as baseStagesApi } from './stages';
import { ApiError, req } from './client';
import { createClientRequestId } from '@/lib/clientRequestId';

async function addStageComment(
  userId: string,
  projectId: string,
  stageId: string,
  text: string,
) {
  const client_request_id = createClientRequestId('stage-comment');
  const body = JSON.stringify({ client_request_id, text });
  const path = `/api/v1/projects/${projectId}/stages/${stageId}/comments`;
  try {
    return await req(path, { method: 'POST', body }, userId);
  } catch (error) {
    if (
      error instanceof ApiError
      && error.status >= 400
      && error.status < 500
      && error.status !== 429
    ) {
      throw error;
    }
    const { enqueue } = await import('@/lib/offlineQueue');
    await enqueue({ path, method: 'POST', body, userId });
    throw new Error('offline_queued');
  }
}

export const stagesApi = {
  ...baseStagesApi,
  addStageComment,
};
