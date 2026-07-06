/** Список чатов: фильтр объектов, архив, закрепление — каждый чат привязан к одному объекту */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, ScrollView, Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { RenovaTheme, card } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { ChatBadge } from '@/components/renova/chat/ChatBadge';
import { ChatProjectFilterDropdown } from '@/components/renova/chat/ChatProjectFilter';
import { FilterDropdown } from '@/components/renova/FilterDropdown';
import { useRenova } from '@/lib/context/RenovaContext';
import { indexChats } from '@/lib/chatSearchCache';
import { api, ChatThread } from '@/lib/api';
import { useNavFromHere } from '@/lib/navigation';
import { useChatUnread, useInboxWsListener } from '@/lib/useChatUnread';
import { useChatFallbackPoll } from '@/lib/useChatWebSocket';
import { getChatProjectFilter, setChatProjectFilter } from '@/lib/chatPrefs';
import {
  CHAT_FILTER_ALL,
  filterChatThreads,
  normalizeChatProjectFilter,
  shouldGroupChatsByProject,
  type ChatProjectFilter,
} from '@/lib/chatProjectFilter';
import { chatListPreview, sortChatThreads } from '@/lib/chatPreview';
import { createProjectChat } from '@/lib/createProjectChat';
import { pickPrimaryDemoProject } from '@/lib/pickPrimaryDemoProject';

type Folder = 'active' | 'archive';

function ThreadCard({
  thread,
  preview,
  onOpen,
  onLongPress,
  showProject,
}: {
  thread: ChatThread;
  preview: string;
  onOpen: () => void;
  onLongPress: () => void;
  showProject?: boolean;
}) {
  const unread = thread.unread_count || 0;
  return (
    <Pressable
      style={[s.card, thread.is_pinned && s.cardPinned]}
      onPress={onOpen}
      onLongPress={onLongPress}
    >
      <View style={s.cardHead}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={s.titleRow}>
            {thread.is_pinned ? <Text style={s.pinIcon}>📌</Text> : null}
            <Text style={s.title} numberOfLines={1}>{thread.title}</Text>
          </View>
          {showProject && thread.project_name ? (
            <Text style={s.projectName} numberOfLines={1}>{thread.project_name}</Text>
          ) : null}
          <Text style={s.preview} numberOfLines={1}>{preview}</Text>
        </View>
        <View style={s.rightCol}>
          <Text style={s.meta}>{thread.updated_at.slice(0, 16).replace('T', ' ')}</Text>
          {unread > 0 ? <ChatBadge count={unread} inline size={20} /> : null}
        </View>
      </View>
    </Pressable>
  );
}

export function ChatListView() {
  const nav = useNavFromHere();
  const { user, activeProject, projects, loadProject } = useRenova();
  const { reload: reloadUnread, inboxWsConnected } = useChatUnread(user?.id);
  const [folder, setFolder] = useState<Folder>('active');
  const [projectFilter, setProjectFilterState] = useState<ChatProjectFilter>(CHAT_FILTER_ALL);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [title, setTitle] = useState('Согласование материалов');
  const [createProjectId, setCreateProjectId] = useState<string | null>(null);

  const projectOptions = useMemo(
    () => projects.map((p) => ({ id: p.id, name: p.name })),
    [projects],
  );

  useEffect(() => {
    if (!projectOptions.length) {
      setPrefsLoaded(true);
      return;
    }
    getChatProjectFilter().then((saved) => {
      setProjectFilterState(normalizeChatProjectFilter(saved, projectOptions.map((p) => p.id)));
      setPrefsLoaded(true);
    });
  }, [projectOptions.map((p) => p.id).join('|')]);

  useEffect(() => {
    if (activeProject?.id) setCreateProjectId(activeProject.id);
    else setCreateProjectId(pickPrimaryDemoProject(projects)?.id ?? projects[0]?.id ?? null);
  }, [activeProject?.id, projects]);

  const applyProjectFilter = async (next: ChatProjectFilter) => {
    const normalized = normalizeChatProjectFilter(next, projectOptions.map((p) => p.id));
    setProjectFilterState(normalized);
    await setChatProjectFilter(normalized);
  };

  const reload = useCallback(async () => {
    if (!user) return;
    try {
      let list: ChatThread[] = [];
      if (projects.length > 0) {
        list = await api.chatInbox(user.id);
      } else if (activeProject) {
        list = await api.listChats(user.id, activeProject.id, folder === 'archive');
      }
      const filtered = list.filter((t) => (folder === 'archive' ? t.is_archived : !t.is_archived));
      const sorted = sortChatThreads(filtered);
      setThreads(sorted);
      indexChats(sorted);
      await reloadUnread();
    } catch {
      setThreads([]);
    }
  }, [user?.id, activeProject?.id, folder, projects.length, reloadUnread]);

  useFocusEffect(useCallback(() => { if (prefsLoaded) reload().catch(() => {}); }, [reload, prefsLoaded]));
  useInboxWsListener(useCallback(() => {
    reload().catch(() => {});
    reloadUnread().catch(() => {});
  }, [reload, reloadUnread]));
  useChatFallbackPoll(!!user && !inboxWsConnected, 12_000, () => { reload().catch(() => {}); });

  const displayThreads = useMemo(
    () => filterChatThreads(threads, projectFilter),
    [threads, projectFilter],
  );

  const groupByProject = shouldGroupChatsByProject(projectFilter, projectOptions.length);
  const showProjectInCard = !groupByProject && projectOptions.length > 1;

  const grouped = useMemo(() => {
    if (!groupByProject) return [{ key: 'all', label: '', items: displayThreads }];
    const map = new Map<string, { label: string; items: ChatThread[] }>();
    for (const t of displayThreads) {
      const key = t.project_id;
      const label = t.project_name || projects.find((p) => p.id === key)?.name || 'Объект';
      const g = map.get(key) || { label, items: [] };
      g.items.push(t);
      map.set(key, g);
    }
    return [...map.entries()]
      .map(([key, v]) => ({ key, label: v.label, items: sortChatThreads(v.items) }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ru'));
  }, [displayThreads, groupByProject, projects]);

  const openThread = async (t: ChatThread) => {
    if (!t.project_id) {
      Alert.alert('Ошибка', 'Чат не привязан к объекту. Создайте новый чат для объекта.');
      return;
    }
    if (activeProject?.id !== t.project_id) {
      await loadProject(t.project_id).catch(() => {});
    }
    nav.chat(t.id);
  };

  const threadActions = (t: ChatThread) => {
    if (!user) return;
    if (!t.project_id) {
      Alert.alert('Ошибка', 'Чат не привязан к объекту.');
      return;
    }
    Alert.alert(t.title, t.project_name || undefined, [
      {
        text: t.is_pinned ? 'Открепить' : 'Закрепить',
        onPress: () => api.patchChatState(user.id, t.project_id, t.id, { is_pinned: !t.is_pinned }).then(reload),
      },
      {
        text: folder === 'archive' ? 'Вернуть из архива' : 'В архив',
        onPress: () => api.patchChatState(user.id, t.project_id, t.id, { is_archived: folder !== 'archive' }).then(reload),
      },
      { text: 'Отмена', style: 'cancel' },
    ]);
  };

  const createChat = async () => {
    if (!user) return;
    const projectId = createProjectId || activeProject?.id;
    if (!projectId) {
      Alert.alert('Нет объекта', 'Сначала создайте или выберите объект — каждый чат привязан к одному объекту.');
      return;
    }
    await createProjectChat({
      userId: user.id,
      projectId,
      title,
      existingThreads: threads,
      onOpen: (id) => nav.chat(id),
    });
    await reload();
  };

  const totalUnread = displayThreads.reduce((a, t) => a + (t.unread_count || 0), 0);
  const canCreate = folder === 'active' && projects.length > 0;
  const createProjectOptions = useMemo(
    () => projectOptions.map((p) => ({ value: p.id, label: p.name })),
    [projectOptions],
  );

  if (!prefsLoaded) {
    return (
      <View style={s.wrap}>
        <Text style={s.empty}>Загрузка…</Text>
      </View>
    );
  }

  return (
    <ScrollView style={s.wrap} contentContainerStyle={{ padding: 16, paddingBottom: 24 }}>
      <View style={s.toolbar}>
        <Pressable style={[s.tab, folder === 'active' && s.tabOn]} onPress={() => setFolder('active')}>
          <Text style={[s.tabT, folder === 'active' && s.tabTOn]}>
            Чаты{folder === 'active' && totalUnread ? ` · ${totalUnread}` : ''}
          </Text>
        </Pressable>
        <Pressable style={[s.tab, folder === 'archive' && s.tabOn]} onPress={() => setFolder('archive')}>
          <Text style={[s.tabT, folder === 'archive' && s.tabTOn]}>Архив</Text>
        </Pressable>
      </View>

      {projectOptions.length > 0 ? (
        <ChatProjectFilterDropdown
          projects={projectOptions}
          value={projectFilter}
          onChange={applyProjectFilter}
        />
      ) : null}

      {canCreate && (
        <View style={s.new}>
          {projects.length > 1 ? (
            <FilterDropdown
              title="Объект чата"
              hint="Каждый чат привязан ровно к одному объекту"
              value={createProjectId || projectOptions[0]?.id || ''}
              options={createProjectOptions}
              onChange={setCreateProjectId}
            />
          ) : projects.length === 1 ? (
            <Text style={s.singleProject}>Объект: {pickPrimaryDemoProject(projects)?.name ?? projects[0]?.name}</Text>
          ) : null}
          <TextInput style={s.input} value={title} onChangeText={setTitle} placeholder="Тема чата" />
          <PrimaryButton title="Создать чат" onPress={createChat} />
        </View>
      )}

      {grouped.map((g) => (
        <View key={g.key}>
          {g.label ? <Text style={s.groupHead}>{g.label}</Text> : null}
          {g.items.map((t) => (
            <ThreadCard
              key={`${t.project_id}-${t.id}`}
              thread={t}
              preview={chatListPreview(t)}
              showProject={showProjectInCard}
              onOpen={() => openThread(t)}
              onLongPress={() => threadActions(t)}
            />
          ))}
        </View>
      ))}

      {!displayThreads.length && (
        <Text style={s.empty}>
          {folder === 'archive'
            ? 'Архив пуст'
            : projects.length
              ? 'Нет чатов по выбранным объектам — создайте новый'
              : 'Создайте объект, чтобы начать переписку'}
        </Text>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: RenovaTheme.colors.background },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12, alignItems: 'center' },
  tab: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: RenovaTheme.colors.border, backgroundColor: RenovaTheme.colors.surface },
  tabOn: { borderColor: RenovaTheme.colors.accent, backgroundColor: '#EFF6FF' },
  tabT: { fontSize: 13, fontWeight: '600', color: RenovaTheme.colors.textMuted },
  tabTOn: { color: RenovaTheme.colors.accent },
  new: { ...card, marginBottom: 12, gap: 8 },
  singleProject: { fontSize: 13, fontWeight: '600', color: RenovaTheme.colors.textMuted },
  input: { borderWidth: 1, borderColor: RenovaTheme.colors.border, borderRadius: 8, padding: 10 },
  groupHead: { fontSize: 11, fontWeight: '700', color: RenovaTheme.colors.textMuted, textTransform: 'uppercase', marginBottom: 6, marginTop: 4 },
  card: { ...card, marginBottom: 8, padding: 12 },
  cardPinned: { borderColor: RenovaTheme.colors.accent, backgroundColor: '#F8FAFF' },
  cardHead: { flexDirection: 'row', gap: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pinIcon: { fontSize: 12 },
  title: { fontWeight: '700', fontSize: 16, flex: 1, color: RenovaTheme.colors.text },
  projectName: { fontSize: 11, color: RenovaTheme.colors.accent, fontWeight: '600', marginTop: 2 },
  preview: { color: RenovaTheme.colors.textMuted, marginTop: 4, fontSize: 13 },
  rightCol: { alignItems: 'flex-end', minWidth: 56 },
  meta: { fontSize: 10, color: RenovaTheme.colors.textMuted },
  empty: { fontSize: 13, color: RenovaTheme.colors.textMuted, textAlign: 'center', marginTop: 24 },
});
