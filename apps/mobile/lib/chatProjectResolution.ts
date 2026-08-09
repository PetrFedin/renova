type HttpErrorLike = { status?: unknown };

type ChatInboxItem = {
  id: string;
  project_id: string;
};

type ChatProjectApi = {
  getChat: (userId: string, projectId: string, threadId: string) => Promise<unknown>;
  chatInbox: (userId: string) => Promise<ChatInboxItem[]>;
};

/**
 * Backend chat ACL deliberately returns 404 when a thread does not belong to the
 * supplied project. Only that case is safe to recover by looking the thread up in
 * the cross-project inbox. Auth, transport and server failures must not be treated
 * as evidence that the chat belongs to another project.
 */
export function isChatProjectMiss(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  return (error as HttpErrorLike).status === 404;
}

/**
 * Resolve a thread to an authorized project without fabricating context.
 *
 * - candidateProjectId is always validated, including project ids supplied by a deep link;
 * - only a backend 404 is interpreted as a project/thread mismatch and may trigger inbox lookup;
 * - auth, server and transport errors propagate to the caller;
 * - the inbox result is validated again before the thread UI is mounted.
 */
export async function resolveChatProjectId(input: {
  api: ChatProjectApi;
  userId: string;
  threadId: string;
  candidateProjectId?: string | null;
}): Promise<string | null> {
  const { api, userId, threadId, candidateProjectId } = input;

  if (candidateProjectId) {
    try {
      await api.getChat(userId, candidateProjectId, threadId);
      return candidateProjectId;
    } catch (error) {
      if (!isChatProjectMiss(error)) throw error;
    }
  }

  const inbox = await api.chatInbox(userId);
  const found = inbox.find((item) => item.id === threadId);
  if (!found?.project_id) return null;

  try {
    await api.getChat(userId, found.project_id, threadId);
    return found.project_id;
  } catch (error) {
    if (isChatProjectMiss(error)) return null;
    throw error;
  }
}
