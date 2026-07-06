/** Связанные разделы на экране этапа */
import { useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert } from 'react-native';
import { router } from 'expo-router';
import { RenovaTheme } from '@/constants/Theme';
import { StageRoomPicker } from '@/components/renova/StageRoomPicker';
import type { ProjectDetail, StageDetail, User } from '@/lib/api';
import { api } from '@/lib/api';
import {
  budgetTabRoute,
  calendarTabRoute,
  objectTabRoute,
  repairTabRoute,
  tabsRoute,
  type OsRole,
} from '@/constants/osSections';
import { pushOsNav } from '@/lib/pushOsNav';
import { findStageChatThread } from '@/lib/domain/findStageChatThread';
import { createProjectChat } from '@/lib/createProjectChat';

type Props = {
  role: OsRole;
  user: User;
  project: ProjectDetail;
  stage: StageDetail;
  stageId: string;
  canWrite: boolean;
  onRoomsChanged: () => void;
};

export function StageDetailLinks({ role, user, project, stage, stageId, canWrite, onRoomsChanged }: Props) {
  const [openingChat, setOpeningChat] = useState(false);
  const stageReturn = `/stage/${stageId}`;
  const chatTopic = `stage:${stageId}`;
  const chatTitle = `Этап: ${stage.name}`;

  async function openStageChat() {
    if (openingChat) return;
    setOpeningChat(true);
    try {
      const chats = await api.listChats(user.id, project.id);
      const thread = findStageChatThread(chats, stage, project.rooms || []);
      if (thread) {
        router.push({
          pathname: '/chat/[threadId]',
          params: { threadId: thread.id, returnTo: stageReturn },
        } as any);
        return;
      }
      await createProjectChat({
        userId: user.id,
        projectId: project.id,
        title: chatTitle,
        topic: chatTopic,
        existingThreads: chats,
        onOpen: (threadId) => {
          router.push({
            pathname: '/chat/[threadId]',
            params: { threadId, returnTo: stageReturn },
          } as any);
        },
      });
    } catch {
      Alert.alert('Ошибка', 'Не удалось открыть чат по этапу');
    } finally {
      setOpeningChat(false);
    }
  }

  return (
    <View style={s.links}>
      <Text style={s.linksTitle}>Связанные разделы</Text>
      <Pressable onPress={() => pushOsNav(repairTabRoute(role, 'works'), stageReturn)}>
        <Text style={s.link}>→ Этапы</Text>
      </Pressable>
      {project.rooms?.length ? (
        <StageRoomPicker
          rooms={project.rooms}
          selected={stage.room_ids || []}
          disabled={!canWrite || user.role === 'customer'}
          onChange={async (room_ids) => {
            await api.patchStageRooms(user.id, project.id, stage.id, room_ids);
            onRoomsChanged();
          }}
        />
      ) : (
        <Pressable onPress={() => pushOsNav(objectTabRoute(role, 'rooms'), stageReturn)}>
          <Text style={s.link}>→ Комнаты</Text>
        </Pressable>
      )}
      <Pressable
        onPress={() =>
          pushOsNav(
            budgetTabRoute(role, 'expenses', { stageId: stage.id, roomId: stage.room_ids?.[0] }),
            stageReturn,
          )
        }
      >
        <Text style={s.link}>→ Расходы этапа</Text>
      </Pressable>
      <Pressable onPress={() => pushOsNav(tabsRoute(role, 'budget'), stageReturn)}>
        <Text style={s.link}>→ Бюджет</Text>
      </Pressable>
      <Pressable onPress={() => { openStageChat().catch(() => {}); }} disabled={openingChat}>
        <Text style={[s.link, openingChat && s.linkBusy]}>
          {openingChat ? '→ Связь…' : '→ Связь'}
        </Text>
      </Pressable>
      <Pressable onPress={() => pushOsNav(calendarTabRoute(role), stageReturn)}>
        <Text style={s.link}>→ Сроки</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  links: { marginBottom: 8 },
  linksTitle: { fontWeight: '700', marginBottom: 6 },
  link: { color: RenovaTheme.colors.primary, paddingVertical: 4, fontWeight: '600' },
  linkBusy: { opacity: 0.5 },
});
