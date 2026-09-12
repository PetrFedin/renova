/** Replay-safe queued chat reaction intents. */
import { req } from './client';
import { canQueueChatCommand } from './chatCommands';
import { createClientRequestId } from '@/lib/clientRequestId';

export const chatReactionIntentsApi = {
  reactChatMessage: async (
    userId: string,
    projectId: string,
    threadId: string,
    messageId: string,
    emoji: string,
  ) => {
    const path = `/api/v1/projects/${projectId}/chats/${threadId}/messages/${messageId}/react`;
    const body = JSON.stringify({
      client_request_id: createClientRequestId('chat-reaction'),
      emoji,
    });
    try {
      return await req<{ reactions: Record<string, string[]> }>(
        path,
        { method: 'POST', body },
        userId,
      );
    } catch (error) {
      if (!canQueueChatCommand(error)) throw error;
      const { enqueue } = await import('@/lib/offlineQueue');
      // Preserve the exact first reaction intent. Replaying these bytes is safe
      // because the server executes one client_request_id at most once.
      await enqueue({ path, method: 'POST', body, userId });
      throw new Error('offline_queued');
    }
  },
};
