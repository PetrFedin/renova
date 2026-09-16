/** Replay-safe stage comments and photos. Overrides legacy stagesApi create helpers. */
import { req, ApiError } from './client';
import { shouldQueueReplaySafeMutation } from './failurePolicy';
import { createClientRequestId } from '@/lib/clientRequestId';
import { OFFLINE_UPLOAD_BLOCKED } from '@/lib/offlineErrors';

async function submitPhotoMetadata(
  userId: string,
  projectId: string,
  stageId: string,
  body: {
    caption?: string;
    image_data?: string;
    storage_key?: string;
    client_request_id: string;
  },
  options: { allowMetadataQueue: boolean },
) {
  const path = `/api/v1/projects/${projectId}/stages/${stageId}/photos`;
  const serialized = JSON.stringify(body);
  const hasInlineBinary = Boolean(body.image_data);
  const send = () => req(path, { method: 'POST', body: serialized }, userId);

  try {
    return await send();
  } catch (firstError) {
    if (!shouldQueueReplaySafeMutation(firstError)) throw firstError;

    if (hasInlineBinary) {
      // Inline base64 may be large. One bounded replay keeps the same request ID
      // and deterministic backend storage key without persisting binary in the
      // JSON offline queue.
      try {
        return await send();
      } catch (retryError) {
        if (!shouldQueueReplaySafeMutation(retryError)) throw retryError;
        throw new Error(OFFLINE_UPLOAD_BLOCKED);
      }
    }

    if (!options.allowMetadataQueue) throw new Error(OFFLINE_UPLOAD_BLOCKED);
    const { enqueue } = await import('@/lib/offlineQueue');
    await enqueue({ path, method: 'POST', body: serialized, userId });
    throw new Error('offline_queued');
  }
}

async function putPresignedPhoto(url: string, blob: Blob): Promise<'confirmed' | 'ambiguous'> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'PUT',
        body: blob,
        headers: { 'Content-Type': 'image/jpeg' },
      });
      if (response.ok) return 'confirmed';
      if (response.status !== 429 && response.status < 500) {
        throw new ApiError(response.status, `Stage photo upload failed with status ${response.status}`);
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      // Transport failure after PUT is ambiguous; replay the same PUT/key once.
    }
  }
  return 'ambiguous';
}

export const stageContentApi = {
  addStageComment: async (
    userId: string,
    projectId: string,
    stageId: string,
    text: string,
    clientRequestId?: string,
  ) => {
    const path = `/api/v1/projects/${projectId}/stages/${stageId}/comments`;
    const body = JSON.stringify({
      text,
      client_request_id: clientRequestId ?? createClientRequestId('stage-comment'),
    });
    try {
      return await req(path, { method: 'POST', body }, userId);
    } catch (error) {
      if (!shouldQueueReplaySafeMutation(error)) throw error;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({ path, method: 'POST', body, userId });
      throw new Error('offline_queued');
    }
  },

  addStagePhoto: async (
    userId: string,
    projectId: string,
    stageId: string,
    image_data?: string,
    caption?: string,
    storage_key?: string,
    _image_url?: string,
    clientRequestId?: string,
  ) => {
    const requestId = clientRequestId ?? createClientRequestId('stage-photo');
    if (storage_key) {
      return submitPhotoMetadata(
        userId,
        projectId,
        stageId,
        { storage_key, caption, client_request_id: requestId },
        { allowMetadataQueue: true },
      );
    }
    if (!image_data) throw new ApiError(422, 'Фото не содержит данных', 'stage_photo_source_required');
    return submitPhotoMetadata(
      userId,
      projectId,
      stageId,
      { image_data, caption, client_request_id: requestId },
      { allowMetadataQueue: false },
    );
  },

  /**
   * Preferred photo path for a selected Blob.
   * - one request ID is minted before the first external write;
   * - the same presigned storage key is PUT at most twice;
   * - after ambiguous PUT, metadata attach acts as a storage existence probe;
   * - binary is never persisted in the JSON offline queue.
   * Returns inline_required only when this environment has no presigned upload
   * URL, so the caller may use deterministic inline fallback with the SAME ID.
   */
  uploadStagePhoto: async (
    userId: string,
    projectId: string,
    stageId: string,
    blob: Blob,
    caption?: string,
    clientRequestId?: string,
  ) => {
    const requestId = clientRequestId ?? createClientRequestId('stage-photo');
    const up = await req<{ key: string; upload_url: string | null; public_url: string }>(
      '/api/v1/media/upload-url',
      { method: 'POST' },
      userId,
    );
    if (!up.upload_url) {
      return { kind: 'inline_required' as const, client_request_id: requestId };
    }

    const putOutcome = await putPresignedPhoto(up.upload_url, blob);
    const result = await submitPhotoMetadata(
      userId,
      projectId,
      stageId,
      { storage_key: up.key, caption, client_request_id: requestId },
      { allowMetadataQueue: putOutcome === 'confirmed' },
    );
    return { kind: 'attached' as const, result };
  },
};
