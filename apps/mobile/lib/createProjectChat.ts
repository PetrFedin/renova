/** Создание чата: одно уникальное название на объект — дубликаты открываются, не создаются */
import { Alert } from 'react-native';
import { api, type ChatThread } from '@/lib/api';
import { findExistingChat } from '@/lib/chatPreview';

export type ChatParticipantInvite = {
  phone?: string;
  profile_code?: string;
};

type CreateOpts = {
  userId: string;
  projectId: string;
  title: string;
  topic?: string;
  existingThreads?: ChatThread[];
  invites?: ChatParticipantInvite[];
  onOpen: (threadId: string) => void;
};

export async function createProjectChat({
  userId,
  projectId,
  title,
  topic = 'general',
  existingThreads = [],
  invites = [],
  onOpen,
}: CreateOpts): Promise<ChatThread | null> {
  if (!projectId?.trim()) {
    Alert.alert('Объект обязателен', 'Выберите объект — каждый чат привязан к одному объекту.');
    return null;
  }
  const trimmed = title.trim() || 'Чат';
  const dup = findExistingChat(existingThreads, projectId, trimmed, topic);

  if (dup) {
    onOpen(dup.id);
    return dup;
  }

  const t = await api.createChat(userId, projectId, trimmed, topic);

  for (const inv of invites) {
    if (!inv.phone && !inv.profile_code) continue;
    try {
      await api.inviteToChat(userId, projectId, t.id, inv);
    } catch {
      /* приглашение не блокирует создание чата */
    }
  }

  onOpen(t.id);
  return t;
}
