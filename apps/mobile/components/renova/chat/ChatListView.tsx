/** Список чатов: фильтр объектов, архив, закрепление — каждый чат привязан к одному объекту.
 * Clarity D: unread только в dock; в списке — title + 1 строка preview. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { RenovaTheme } from '@/constants/Theme';
import { screenTypography, listRowStyles } from '@/constants/screenTypography';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { EmptyActionState } from '@/components/ui/EmptyActionState';
import { LoadErrorState } from '@/components/ui/LoadErrorState';
import { ChatProjectFilterDropdown } from '@/components/renova/chat/ChatProjectFilter';
import { CreateChatSheet } from '@/components/renova/chat/CreateChatSheet';
import { useRenova } from '@/lib/context/RenovaContext';
import { indexChats } from '@/lib/chatSearchCache';
import { api, ChatThread } from '@/lib/api';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { useNavFromHere } from '@/lib/navigation';
import { useChatUnread, useChatInboxThreads, useInboxWsListener } from '@/lib/useChatUnread';
import { useChatFallbackPoll } from '@/lib/useChatWebSocket';
import { getChatProjectFilter, setChatProjectFilter } from '@/lib/chatPrefs';
import { CHAT_FILTER_ALL, filterChatThreads, normalizeChatProjectFilter, shouldGroupChatsByProject, type ChatProjectFilter } from '@/lib/chatProjectFilter';
import { chatListPreview, sortChatThreads } from '@/lib/chatPreview';
import { threadAwaitingReply } from '@/lib/chatAttention';
import { resolveChatCreateProject } from '@/lib/resolveChatCreateProject';
import { isOfflineQueued, notifyOfflineQueued } from '@/lib/offlineUi';
import { reportCatch } from '@/lib/reportError';
import { showActionConfirm } from '@/lib/actionConfirmBus';

type Folder = 'active' | 'archive';

function ThreadCard({
  thread,
  preview,
  onOpen,
  onLongPress,
  showProject,
  viewerRole,
}: {
  thread: ChatThread;
  preview: string;
  onOpen: () => void;
  onLongPress: () => void;
  showProject?: boolean;
  viewerRole?: 'customer' | 'contractor';
}) {
  const unread = thread.unread_count || 0;
  const awaiting = !unread && threadAwaitingReply(thread, viewerRole);
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
            {/* Clarity D: точечный attention без цифры unread (цифра — только dock) */}
            {unread > 0 || awaiting ? <View style={[s.awaitDot, unread > 0 && s.unreadDot]} /> : null}
          </View>
          {showProject && thread.project_name ? (
            <Text style={s.projectName} numberOfLines={1}>{thread.project_name}</Text>
          ) : null}
          <Text style={s.preview} numberOfLines={1}>{preview}</Text>
        </View>
      </View>
    </Pressable>
  );
}

export function ChatListView() {
  const nav = useNavFromHere();
  const { user, activeProject, projects, loadProject } = useRenova();
  const { reload: reloadUnread, inboxWsConnected, count: globalUnread, failed: unreadFailed } = useChatUnread(user?.id, user?.role);
  const { threads: storeThreads, reload: reloadStore } = useChatInboxThreads(user?.id, user?.role);
  const [folder, setFolder] = useState<Folder>('active');
  const [projectFilter, setProjectFilterState] = useState<ChatProjectFilter>(CHAT_FILTER_ALL);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [localThreads, setLocalThreads] = useState<ChatThread[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

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

  const createProject = useMemo(
    () => resolveChatCreateProject(projectFilter, projectOptions, activeProject?.id),
    [projectFilter, projectOptions, activeProject?.id],
  );

  const applyProjectFilter = async (next: ChatProjectFilter) => {
    const normalized = normalizeChatProjectFilter(next, projectOptions.map((p) => p.id));
    setProjectFilterState(normalized);
    await setChatProjectFilter(normalized);
  };

  const reload = useCallback(async () => {
    if (!user) return;
    setLoadError(false);
    try {
      if (projects.length > 0) {
        await reloadStore();
      } else if (activeProject) {
        const list = await api.listChats(user.id, activeProject.id, folder === 'archive');
        setLocalThreads(sortChatThreads(list));
        indexChats(list);
      }
      await reloadUnread();
    } catch {
      setLoadError(true);
    }
  }, [user?.id, activeProject?.id, folder, projects.length, reloadUnread, reloadStore]);

  const sourceThreads = projects.length > 0 ? storeThreads : localThreads;
  const threads = useMemo(
    () => sourceThreads.filter((t) => (folder === 'archive' ? t.is_archived : !t.is_archived)),
    [sourceThreads, folder],
  );

  useEffect(() => {
    if (threads.length) indexChats(threads);
  }, [threads]);

  useFocusEffect(useCallback(() => { if (prefsLoaded) reload().catch(reportCatch('components.renova.chat.ChatListView.1')); }, [reload, prefsLoaded]));
  const onBusReload = useCallback(() => {
    if (prefsLoaded) void reload();
  }, [prefsLoaded, reload]);
  useProjectDataReload(onBusReload);
  useInboxWsListener(useCallback(() => {
    reload().catch(reportCatch('components.renova.chat.ChatListView.2'));
    reloadUnread().catch(reportCatch('components.renova.chat.ChatListView.3'));
  }, [reload, reloadUnread]));
  useChatFallbackPoll(!!user && !inboxWsConnected, 12_000, () => { reload().catch(reportCatch('components.renova.chat.ChatListView.4')); });

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
    // Mark-read только в ChatThreadView после видимости — здесь только навигация.
    if (activeProject?.id !== t.project_id) {
      await loadProject(t.project_id).catch(reportCatch('components.renova.chat.ChatListView.6'));
    }
    nav.chat(t.id, t.project_id);
  };

  const threadActions = (t: ChatThread) => {
    if (!user) return;
    if (!t.project_id) {
      Alert.alert('Ошибка', 'Чат не привязан к объекту.');
      return;
    }
    showActionConfirm({
      title: t.title,
      message: t.project_name || 'Действия с чатом',
      actions: [
        {
          label: t.is_pinned ? 'Открепить' : 'Закрепить',
          onPress: () => {
            void (async () => {
              try {
                await api.patchChatState(user.id, t.project_id, t.id, { is_pinned: !t.is_pinned });
                await reload();
              } catch (e) {
                if (isOfflineQueued(e)) notifyOfflineQueued(t.is_pinned ? 'Открепление чата' : 'Закрепление чата');
              }
            })();
          },
        },
        {
          label: folder === 'archive' ? 'Вернуть из архива' : 'В архив',
          onPress: () => {
            void (async () => {
              try {
                await api.patchChatState(user.id, t.project_id, t.id, { is_archived: folder !== 'archive' });
                await reload();
              } catch (e) {
                if (isOfflineQueued(e)) notifyOfflineQueued(folder === 'archive' ? 'Восстановление чата' : 'Архивация чата');
              }
            })();
          },
        },
      ],
    });
  };

  const canCreate = folder === 'active' && projects.length > 0;

  if (!prefsLoaded) {
    return (
      <View style={s.wrap}>
        <Text style={s.empty}>Загрузка…</Text>
      </View>
    );
  }

  return (
    <ScrollView style={s.wrap} contentContainerStyle={{ padding: 16, paddingBottom: 24 }}>
      {folder === 'active' && (unreadFailed || loadError) && globalUnread === 0 && displayThreads.length > 0 ? (
        <Pressable onPress={() => reload().catch(reportCatch('components.renova.chat.ChatListView.7'))}>
          <Text style={s.unreadWarn}>Не удалось обновить — нажмите, чтобы повторить</Text>
        </Pressable>
      ) : null}

      <View style={s.toolbar}>
        <Pressable style={[s.tab, folder === 'active' && s.tabOn]} onPress={() => setFolder('active')}>
          <Text style={[s.tabT, folder === 'active' && s.tabTOn]}>Чаты</Text>
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

      {canCreate ? (
        <View style={s.createBtn}>
          <PrimaryButton
            title="Создать чат"
            variant="outline"
            onPress={() => setCreateOpen(true)}
            fullWidth
          />
        </View>
      ) : null}

      {user && createOpen ? (
        <CreateChatSheet
          visible={createOpen}
          onClose={() => setCreateOpen(false)}
          userId={user.id}
          projects={projectOptions}
          defaultProjectId={createProject.projectId}
          projectLocked={createProject.locked}
          selectableProjectIds={createProject.selectableIds}
          existingThreads={threads}
          onCreated={() => reload().catch(reportCatch('components.renova.chat.ChatListView.8'))}
          onOpenChat={(id, projectId) => nav.chat(id, projectId)}
        />
      ) : null}

      {grouped.map((g) => (
        <View key={g.key}>
          {g.label ? <Text style={s.groupHead}>{g.label}</Text> : null}
          {g.items.map((t) => (
            <ThreadCard
              key={`${t.project_id}-${t.id}`}
              thread={t}
              preview={chatListPreview(t)}
              showProject={showProjectInCard}
              viewerRole={user?.role === 'contractor' ? 'contractor' : 'customer'}
              onOpen={() => openThread(t)}
              onLongPress={() => threadActions(t)}
            />
          ))}
        </View>
      ))}

      {!displayThreads.length && loadError ? (
        <LoadErrorState
          title="Не удалось загрузить чаты"
          hint="Это не пустой список — проверьте сеть и повторите."
          onRetry={() => { void reload(); }}
        />
      ) : !displayThreads.length ? (
        folder === 'archive' ? (
          <Text style={s.empty}>Архив пуст</Text>
        ) : projects.length ? (
          <EmptyActionState
            title="Нет чатов по выбранным объектам"
            hint="Создайте переписку — вопросы по смете, срокам и приёмке остаются в одном месте."
            actionLabel={canCreate ? 'Создать чат' : undefined}
            actionVariant="primary"
            onAction={canCreate ? () => setCreateOpen(true) : undefined}
          />
        ) : (
          <EmptyActionState
            title="Нет объектов для чата"
            hint="Создайте или выберите объект, чтобы начать переписку."
          />
        )
      ) : null}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: RenovaTheme.colors.background },
  unreadWarn: { fontSize: 12, color: RenovaTheme.colors.warning, marginBottom: 8, textAlign: 'center' },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12, alignItems: 'center' },
  tab: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: RenovaTheme.colors.border, backgroundColor: RenovaTheme.colors.surface },
  tabOn: { borderColor: RenovaTheme.colors.accent, backgroundColor: RenovaTheme.colors.infoBg },
  tabT: { fontSize: 13, fontWeight: '600', color: RenovaTheme.colors.textMuted },
  tabTOn: { color: RenovaTheme.colors.accent },
  createBtn: { marginBottom: 12 },
  groupHead: { ...screenTypography.section, marginBottom: 6, marginTop: 4 },
  /** Clarity K: list-row чатов, не card-стек */
  card: { ...listRowStyles.row, paddingVertical: 12 },
  cardPinned: { ...listRowStyles.rowFocus },
  cardHead: { flexDirection: 'row', gap: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pinIcon: { fontSize: 12 },
  title: { ...screenTypography.listTitle, fontSize: 16, flex: 1 },
  projectName: { fontSize: 11, color: RenovaTheme.colors.accent, fontWeight: '600', marginTop: 2 },
  preview: { ...screenTypography.listMeta, marginTop: 4 },
  awaitDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: RenovaTheme.colors.warning },
  unreadDot: { backgroundColor: RenovaTheme.colors.danger },
  empty: { ...screenTypography.empty, textAlign: 'center', marginTop: 24 },
});
