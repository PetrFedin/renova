/** Создание чата: одно уникальное название на объект — дубликаты открываются, не создаются */
import { api, type ChatThread, type User } from '@/lib/api';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { findExistingChat } from '@/lib/chatPreview';
import { showActionConfirm } from '@/lib/actionConfirmBus';
import { reportError } from '@/lib/reportError';

export type ChatParticipantInvite = {
  phone?: string;
  profile_code?: string;
};

export type CreateProjectChatResult = {
  thread: ChatThread | null;
  created: boolean;
  failedInvites: number;
};

type CreateCommonOpts = {
  projectId: string;
  title: string;
  topic?: string;
  existingThreads?: ChatThread[];
  invites?: ChatParticipantInvite[];
  onOpen: (threadId: string) => void;
};

type CreateOpts = CreateCommonOpts & (
  | { user: User; userId?: never }
  | { user?: never; userId: string }
);

function openCommittedThread(onOpen: (threadId: string) => void, threadId: string, projectId: string): void {
  try {
    onOpen(threadId);
  } catch (error) {
    reportError('createProjectChat.onOpen', error, { projectId, threadId });
  }
}

export async function createProjectChat(opts: CreateOpts): Promise<CreateProjectChatResult> {
  const {
    projectId,
    title,
    topic = 'general',
    existingThreads = [],
    invites = [],
    onOpen,
  } = opts;

  if (!projectId?.trim()) {
    // Clarity R: gate sheet вместо Alert
    showActionConfirm({
      title: 'Объект обязателен',
      message: 'Выберите объект — каждый чат привязан к одному объекту.',
    });
    return { thread: null, created: false, failedInvites: 0 };
  }

  // Legacy callers may still only know the session id. Resolve it to the real
  // domain object before the mutation so no post-commit path fabricates User.
  const user = opts.user ?? await api.me(opts.userId);
  const trimmed = title.trim() || 'Чат';
  const dup = findExistingChat(existingThreads, projectId, trimmed, topic);

  if (dup) {
    openCommittedThread(onOpen, dup.id, projectId);
    return { thread: dup, created: false, failedInvites: 0 };
  }

  // Commit boundary: failures below this line must never be reported as if the
  // chat mutation itself failed.
  const thread = await api.createChat(user.id, projectId, trimmed, topic);

  try {
    const project = await api.getProject(user.id, projectId);
    try {
      await syncProjectSideEffects({ user, project });
    } catch (error) {
      reportError('createProjectChat.sideEffects', error, { projectId, threadId: thread.id });
    }
  } catch (error) {
    reportError('createProjectChat.projectRefresh', error, { projectId, threadId: thread.id });
  }

  let failedInvites = 0;
  for (const invite of invites) {
    if (!invite.phone && !invite.profile_code) continue;
    try {
      await api.inviteToChat(user.id, projectId, thread.id, invite);
    } catch (error) {
      failedInvites += 1;
      reportError('createProjectChat.invite', error, {
        projectId,
        threadId: thread.id,
        inviteType: invite.phone ? 'phone' : 'profile_code',
      });
    }
  }

  openCommittedThread(onOpen, thread.id, projectId);
  return { thread, created: true, failedInvites };
}
