/** Экран треда: реакции, закрепление, задачи, счета, участники, файлы */
import { useEffect, useRef, useState, useCallback } from 'react';
import { AppState, ScrollView, View, Text, TextInput, StyleSheet, Pressable, Modal } from 'react-native';
import { confirmAction, notifyError, notifyInfo } from '@/lib/notify';
import { useFocusEffect, usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { RenovaTheme } from '@/constants/Theme';
import { screenTypography } from '@/constants/screenTypography';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { BackHeader } from '@/components/renova/BackHeader';
import { ChatInThreadSearch } from '@/components/renova/ChatInThreadSearch';
import { HighlightText } from '@/components/renova/HighlightText';
import { ReadOnlyBanner, useWriteAllowed } from '@/components/renova/ReadOnlyGuard';
import { reportError, reportCatch } from '@/lib/reportError';
import { api, ChatDetail, ChatMessage } from '@/lib/api';
import { isOfflineQueued, notifyOfflineQueued } from '@/lib/offlineUi';
import { ChatImage } from '@/components/renova/chat/ChatImage';
import { chatAttachmentDataUrl, guessAttachmentMime, validateChatAttachment } from '@/lib/chatAttachment';
import { authorLabel, authorRoleLabel, isMineMessage } from '@/lib/chatMessageAuthor';
import { canLoadEarlier, CHAT_PAGE_SIZE, prependEarlier, reloadWindowSize } from '@/lib/chatHistory';
import { hitsForThread, jumpPlan } from '@/lib/chatSearch';
import { classifyChatFrame } from '@/lib/chatWsFrames';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { ChatTaskSheet } from '@/components/renova/chat/ChatTaskSheet';
import { useChatReadSync } from '@/lib/useChatUnread';
import { useChatWebSocket, useChatFallbackPoll } from '@/lib/useChatWebSocket';
import { isChatCreationSystemMessage } from '@/lib/chatPreview';
import { budgetTabRoute, type OsRole } from '@/constants/osSections';
import { pushOsNav } from '@/lib/pushOsNav';
import { alertChatInviteSent } from '@/lib/fieldCommsNav';
import { alertChatInvoiceCreated, alertChatTaskCreated } from '@/lib/estimatePayNav';
import { showActionConfirm } from '@/lib/actionConfirmBus';
import { textWithoutReplyPrefix } from '@/lib/domain/chatReplyPrefix';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import {
  canLeaveThread,
  canManageThread,
  canRemoveParticipant,
  chatMutationError,
  editedLabel,
  messageActions,
  participantRoleLabel,
  type MessageActions,
} from '@/lib/chatActions';
import { formatClockTime } from '@/lib/formatScheduleDate';

const REACTIONS = ['👍', '✅', '❤️', '🔥', '❓'];

function latestRenderedMessageId(messages: ChatMessage[]): string | null {
  if (!messages.length) return null;
  return [...messages]
    .sort((a, b) => {
      const byTime = a.created_at.localeCompare(b.created_at);
      return byTime || a.id.localeCompare(b.id);
    })
    .slice(-1)[0]?.id ?? null;
}

/** Одно действие над сообщением: иконка с подписью для скринридера. */
function MessageAction({
  icon,
  label,
  onPress,
  active,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  active?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={s.msgAction}
    >
      <Ionicons
        name={icon}
        size={16}
        color={active ? RenovaTheme.colors.accent : RenovaTheme.colors.textMuted}
      />
    </Pressable>
  );
}

function MessageBubble({
  m,
  mine,
  highlight,
  query,
  returnTo,
  osRole,
  canOpenProjectActions,
  onReact,
  onPin,
  onReply,
  onTask,
  onConfirm,
  onPay,
  onEdit,
  onDelete,
  actions,
  busy,
  repliedTo,
  onOpenReplied,
  userId,
  onLayoutY,
}: {
  m: ChatMessage;
  mine: boolean;
  userId: string;
  onLayoutY?: (y: number) => void;
  highlight?: boolean;
  query?: string;
  returnTo?: string;
  osRole: OsRole;
  canOpenProjectActions: boolean;
  onReact: (emoji: string) => void;
  onPin?: () => void;
  onReply: () => void;
  onTask?: () => void;
  onConfirm?: () => void;
  onPay?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  /** Что разрешено над этим сообщением (messageActions). */
  actions: MessageActions;
  /** Идёт запрос: кнопки изменения неактивны (двойной тап). */
  busy?: boolean;
  repliedTo?: ChatMessage | null;
  onOpenReplied?: () => void;
}) {
  // COM-028: имя автора из профиля (если задано) + роль; свои — «Вы».
  const roleLabel = authorLabel(m, mine);
  const isSystem = m.author_role === 'system' || m.message_type === 'system';

  if (isSystem) {
    return (
      <View style={s.systemWrap} onLayout={(e: { nativeEvent: { layout: { y: number } } }) => onLayoutY?.(e.nativeEvent.layout.y)}>
        <Text style={s.systemText}>{m.text}</Text>
        <Text style={s.systemTime}>{formatClockTime(m.created_at)}</Text>
      </View>
    );
  }

  if (m.deleted) {
    return (
      <View
        style={[s.msg, mine ? s.me : s.them, highlight && s.highlight]}
        onLayout={(e: { nativeEvent: { layout: { y: number } } }) => onLayoutY?.(e.nativeEvent.layout.y)}
      >
        <Text style={s.role}>{roleLabel}</Text>
        <Text style={s.deletedText}>Сообщение удалено</Text>
        <Text style={s.time}>{formatClockTime(m.created_at)}</Text>
      </View>
    );
  }

  return (
    <Pressable
      style={[s.msg, mine ? s.me : s.them, highlight && s.highlight, m.is_pinned && s.pinnedMsg]}
      onLayout={(e: { nativeEvent: { layout: { y: number } } }) => onLayoutY?.(e.nativeEvent.layout.y)}
      onLongPress={() => {
        showActionConfirm({
          title: 'Сообщение',
          message: 'Реакция или действие',
          actions: [
            ...REACTIONS.map((e) => ({ label: e, onPress: () => onReact(e) })),
            ...(actions.pin && onPin ? [{ label: m.is_pinned ? 'Открепить' : 'Закрепить', onPress: onPin }] : []),
            ...(actions.reply ? [{ label: 'Ответить', onPress: onReply }] : []),
            ...(actions.edit && onEdit && !busy ? [{ label: 'Редактировать', onPress: onEdit }] : []),
            ...(actions.remove && onDelete && !busy ? [{ label: 'Удалить', onPress: onDelete, destructive: true }] : []),
            ...(onTask ? [{ label: 'Создать задачу', onPress: onTask }] : []),
          ],
        });
      }}
    >
      {m.is_pinned ? <Text style={s.pinTag}>📌 Закреплено</Text> : null}
      <Text style={s.role}>{roleLabel}</Text>
      {/* Сервер хранит связь ответа в `reply_to_id`, но экран её не показывал:
          от ответа оставалась только строчка «↩ …» внутри текста. */}
      {repliedTo ? (
        <Pressable
          onPress={onOpenReplied}
          accessibilityRole="button"
          accessibilityLabel={`Перейти к сообщению, на которое отвечают: ${repliedTo.text || 'вложение'}`}
          style={s.quote}
        >
          <Text style={s.quoteRole}>
            {authorRoleLabel(repliedTo.author_role)}
          </Text>
          <Text style={s.quoteText} numberOfLines={2}>
            {repliedTo.text || 'Вложение'}
          </Text>
        </Pressable>
      ) : null}
      {m.text ? (
        <HighlightText text={textWithoutReplyPrefix(m.text, !!repliedTo)} query={query} />
      ) : null}
      {editedLabel(m) ? <Text style={s.edited}>{editedLabel(m)}</Text> : null}
      {m.message_type === 'payment' && m.confirmed !== true && onPay && (
        <PrimaryButton title="Перейти к оплате" compact onPress={onPay} />
      )}
      {m.message_type === 'confirm' && m.confirmed !== true && onConfirm && (
        <PrimaryButton title="Подтвердить" compact onPress={onConfirm} />
      )}
      {m.confirmed && <Text style={s.ok}>✓ Подтверждено</Text>}
      {m.work_order_id && canOpenProjectActions && (
        <Pressable
          onPress={() =>
            pushOsNav(
              { pathname: '/work-order/[id]', params: { id: m.work_order_id! } },
              returnTo,
              osRole,
            )
          }
        >
          <Text style={s.link}>Открыть задачу →</Text>
        </Pressable>
      )}
      {m.image_url ? <ChatImage uri={m.image_url} userId={userId} /> : null}
      {m.file_name ? <Text style={s.file}>📎 {m.file_name}</Text> : null}
      {m.reactions && Object.keys(m.reactions).length > 0 && (
        <View style={s.reactions}>
          {Object.entries(m.reactions).map(([emoji, users]) => (
            <Pressable key={emoji} style={s.reactChip} onPress={() => onReact(emoji)}>
              <Text style={s.reactText}>{emoji} {users.length}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {/* Все эти действия существовали и раньше — но только через долгое
          нажатие, о котором ничто на экране не сообщало. */}
      <View style={s.msgActions}>
        <MessageAction
          icon="happy-outline"
          label="Поставить реакцию"
          onPress={() =>
            showActionConfirm({
              title: 'Реакция',
              message: 'Выберите реакцию на сообщение',
              actions: REACTIONS.map((emoji) => ({ label: emoji, onPress: () => onReact(emoji) })),
            })
          }
        />
        {actions.reply ? <MessageAction icon="arrow-undo-outline" label="Ответить на сообщение" onPress={onReply} /> : null}
        {actions.edit && onEdit ? (
          <MessageAction icon="create-outline" label="Редактировать сообщение" onPress={() => { if (!busy) onEdit(); }} />
        ) : null}
        {actions.remove && onDelete ? (
          <MessageAction icon="trash-outline" label="Удалить сообщение" onPress={() => { if (!busy) onDelete(); }} />
        ) : null}
        {actions.pin && onPin ? (
          <MessageAction
            icon={m.is_pinned ? 'bookmark' : 'bookmark-outline'}
            label={m.is_pinned ? 'Открепить сообщение' : 'Закрепить сообщение'}
            active={m.is_pinned}
            onPress={onPin}
          />
        ) : null}
        {onTask ? (
          <MessageAction icon="checkbox-outline" label="Создать задачу из сообщения" onPress={onTask} />
        ) : null}
        <Text style={[s.time, s.timeInRow]}>
          {formatClockTime(m.created_at)}{mine && m.read ? ' ✓✓' : ''}
        </Text>
      </View>
    </Pressable>
  );
}

export function ChatThreadView({
  threadId,
  projectId,
  returnTo,
  highlightId,
}: {
  threadId: string;
  projectId: string;
  returnTo?: string;
  highlightId?: string;
}) {
  const pathname = usePathname();
  const { user, activeProject, projects, loadProject } = useRenova();
  const canWrite = useWriteAllowed();
  const syncAfterRead = useChatReadSync(user?.id, user?.role);
  const [chat, setChat] = useState<ChatDetail | null>(null);
  const [screenFocused, setScreenFocused] = useState(false);
  const [appState, setAppState] = useState(AppState.currentState);
  const [renderedReadCursor, setRenderedReadCursor] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const markedCursorRef = useRef<string | null>(null);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [typing, setTyping] = useState(false);
  const [chatQuery, setChatQuery] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invitePhone, setInvitePhone] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [taskMsg, setTaskMsg] = useState<ChatMessage | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Правка сообщения, переименование и «занято»: один запрос за раз, повторный тап игнорируется.
  const [editMsg, setEditMsg] = useState<ChatMessage | null>(null);
  const [editText, setEditText] = useState('');
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameText, setRenameText] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const busyRef = useRef<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const loadGenerationRef = useRef(0);
  // COM-024: окно истории. null = последние сообщения; id = окно вокруг найденного сообщения.
  const anchorIdRef = useRef<string | null>(null);
  const loadedCountRef = useRef(0);
  const layoutYRef = useRef<Record<string, number>>({});
  const stickToBottomRef = useRef(true);
  const restoreScrollToRef = useRef<string | null>(null);
  const jumpRequestedRef = useRef<string | null>(null);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [earlierFailed, setEarlierFailed] = useState(false);
  const [jumpFailed, setJumpFailed] = useState(false);
  const [isOffLatest, setIsOffLatest] = useState(false);
  const hasProjectScope = chat?.capabilities?.access_scope === 'project';
  const canViewProjectActions = hasProjectScope && chat?.capabilities?.can_view_project_actions === true;
  const canManageParticipants = hasProjectScope && chat?.capabilities?.can_manage_participants === true;
  const canCreateTask = hasProjectScope && chat?.capabilities?.can_create_task === true;
  const canCreateInvoice = hasProjectScope && chat?.capabilities?.can_create_invoice === true;

  const loadMessages = useCallback(async () => {
    if (!user || !threadId || !projectId) return;
    const generation = ++loadGenerationRef.current;
    try {
      const detail = await api.getChat(user.id, projectId, threadId, {
        limit: reloadWindowSize(loadedCountRef.current),
        ...(anchorIdRef.current ? { around: anchorIdRef.current } : {}),
      });
      if (generation !== loadGenerationRef.current) return;
      loadedCountRef.current = detail.messages.length;
      if (detail.capabilities?.access_scope === 'project' && activeProject?.id !== projectId) {
        await loadProject(projectId).catch((error) => reportError('chat.loadProject', error, { projectId }));
        if (generation !== loadGenerationRef.current) return;
      }
      setRenderedReadCursor(null);
      setChat(detail);
      setIsOffLatest(!!anchorIdRef.current && detail.has_more_after === true);
      setLoadFailed(false);
    } catch (error) {
      if (generation !== loadGenerationRef.current) return;
      setLoadFailed(true);
      reportError('chat.loadMessages', error, { threadId, projectId });
      throw error;
    }
  }, [user, threadId, projectId, activeProject?.id, loadProject]);

  const markThreadRead = useCallback(async (cursor: string) => {
    if (!user || !threadId || !projectId || !cursor) return;
    if (AppState.currentState !== 'active') return;
    const markKey = `${threadId}:${projectId}:${cursor}`;
    if (markedCursorRef.current === markKey) return;
    try {
      await syncAfterRead(projectId, threadId, cursor);
      markedCursorRef.current = markKey;
    } catch (error) {
      reportError('chat.markRead.sync', error, { threadId, projectId, cursor });
      // Do not record success: next visibility/load edge may safely retry the same cursor.
    }
  }, [user, threadId, projectId, syncAfterRead]);

  const chatRef = useRef<ChatDetail | null>(null);
  chatRef.current = chat;
  const loadMessagesRef = useRef(loadMessages);
  const markThreadReadRef = useRef(markThreadRead);
  loadMessagesRef.current = loadMessages;
  markThreadReadRef.current = markThreadRead;

  useFocusEffect(
    useCallback(() => {
      setScreenFocused(true);
      setRenderedReadCursor(null);
      markedCursorRef.current = null;
      setLoadFailed(false);
      loadMessagesRef.current().catch(reportCatch('chat.loadMessages'));
      return () => {
        setScreenFocused(false);
        setRenderedReadCursor(null);
      };
    }, [threadId, projectId]),
  );

  useEffect(() => {
    markedCursorRef.current = null;
    setRenderedReadCursor(null);
  }, [threadId, projectId]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      setAppState(nextState);
      if (nextState === 'active' && screenFocused) {
        loadMessagesRef.current().catch(reportCatch('chat.loadMessages.foreground'));
      }
    });
    return () => subscription.remove();
  }, [screenFocused, threadId]);

  useEffect(() => {
    if (!chat || !screenFocused || appState !== 'active') {
      setRenderedReadCursor(null);
      return undefined;
    }
    const cursor = latestRenderedMessageId(chat.messages);
    if (!cursor) {
      setRenderedReadCursor(null);
      return undefined;
    }
    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      if (!cancelled) setRenderedReadCursor(cursor);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [chat, screenFocused, appState, threadId]);

  const overlayBlocking = (canManageParticipants && inviteOpen) || settingsOpen || renameOpen || !!editMsg || (canCreateTask && !!taskMsg);

  useEffect(() => {
    if (
      !screenFocused
      || appState !== 'active'
      || AppState.currentState !== 'active'
      || overlayBlocking
      || !renderedReadCursor
      || loadFailed
    ) {
      return;
    }
    markThreadReadRef.current(renderedReadCursor).catch(reportCatch('chat.markRead.visible'));
  }, [screenFocused, appState, overlayBlocking, renderedReadCursor, loadFailed, threadId]);

  const scrollToMessage = useCallback((id: string, attempt = 0) => {
    stickToBottomRef.current = false;
    const y = layoutYRef.current[id];
    if (y == null) {
      // Вёрстка ещё не измерена (окно только что подгружено) — повторить чуть позже.
      if (attempt < 8) setTimeout(() => scrollToMessage(id, attempt + 1), 150);
      return;
    }
    scrollRef.current?.scrollTo({ y: Math.max(0, y - 24), animated: true });
  }, []);

  /** Переход к сообщению: в загруженном окне — прокрутка; иначе подгружаем окно `around` (COM-037). */
  const jumpToMessage = useCallback(async (id: string) => {
    if (!user || !threadId || !projectId) return;
    setJumpFailed(false);
    router.setParams({ highlightId: id });
    const loaded = (chatRef.current?.messages ?? []).map((m) => m.id);
    if (jumpPlan(loaded, id) === 'scroll') {
      scrollToMessage(id);
      return;
    }
    const generation = ++loadGenerationRef.current;
    try {
      const detail = await api.getChat(user.id, projectId, threadId, { around: id, limit: CHAT_PAGE_SIZE });
      if (generation !== loadGenerationRef.current) return;
      anchorIdRef.current = id;
      loadedCountRef.current = detail.messages.length;
      setChat(detail);
      setIsOffLatest(detail.has_more_after === true);
      scrollToMessage(id);
    } catch (error) {
      if (generation !== loadGenerationRef.current) return;
      reportError('chat.jumpToMessage', error, { threadId, projectId, messageId: id });
      setJumpFailed(true);
    }
  }, [user, threadId, projectId, scrollToMessage]);

  useEffect(() => {
    if (!highlightId || !chat) return;
    if (jumpPlan(chat.messages.map((m) => m.id), highlightId) === 'scroll') {
      scrollToMessage(highlightId);
      return;
    }
    if (jumpRequestedRef.current === highlightId) return;
    jumpRequestedRef.current = highlightId;
    void jumpToMessage(highlightId);
  }, [highlightId, chat?.messages.length]);

  /** Подгрузка более ранней истории («Загрузить ранние»). */
  const loadEarlier = useCallback(async () => {
    const current = chatRef.current;
    if (!user || !current || loadingEarlier || !current.messages.length) return;
    setLoadingEarlier(true);
    setEarlierFailed(false);
    try {
      const firstId = current.messages[0].id;
      const page = await api.getChat(user.id, projectId, threadId, { before: firstId, limit: CHAT_PAGE_SIZE });
      restoreScrollToRef.current = firstId;
      stickToBottomRef.current = false;
      setChat((prev) => {
        if (!prev) return prev;
        const messages = prependEarlier(prev.messages, page.messages);
        loadedCountRef.current = messages.length;
        return { ...prev, messages, has_more_before: page.has_more_before };
      });
    } catch (error) {
      reportError('chat.loadEarlier', error, { threadId, projectId });
      setEarlierFailed(true);
    } finally {
      setLoadingEarlier(false);
    }
  }, [user, projectId, threadId, loadingEarlier]);

  const backToLatest = useCallback(() => {
    anchorIdRef.current = null;
    loadedCountRef.current = 0;
    setIsOffLatest(false);
    stickToBottomRef.current = true;
    router.setParams({ highlightId: '' });
    loadMessagesRef.current().catch(reportCatch('chat.backToLatest'));
  }, []);

  const searchInThread = useCallback(async (q: string) => {
    if (!user) return [];
    const hits = await api.searchChatMessages(user.id, projectId, q);
    return hitsForThread(hits, threadId).map((h) => ({ id: h.id, text: h.text }));
  }, [user, projectId, threadId]);

  const reload = useCallback(() => loadMessages().catch(reportCatch('chat.reload')), [loadMessages]);
  useProjectDataReload(reload);

  // Кадры часто идут пачкой (сообщение + реакция + прочтение) — один reload на пачку.
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleReload = useCallback(() => {
    if (reloadTimerRef.current) return;
    reloadTimerRef.current = setTimeout(() => {
      reloadTimerRef.current = null;
      reload();
    }, 300);
  }, [reload]);
  useEffect(() => () => {
    if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
  }, []);

  const { send: wsSend, connected: wsConnected } = useChatWebSocket(threadId, !!user && !!projectId,
    (payload) => {
      const action = classifyChatFrame(payload);
      if (action === 'typing') {
        setTyping(true);
        setTimeout(() => setTyping(false), 2000);
        return;
      }
      // Delivery is not reading. Reload first; visibility+render gate decides later.
      // Прочтение, pin, подтверждение, правка, удаление — тоже перезагрузка, без ручного перезахода.
      if (action === 'reload') scheduleReload();
    },
    // После переподключения кадры, пришедшие пока сокет был закрыт, потеряны — догружаем.
    () => { reload(); },
  );

  useChatFallbackPoll(!wsConnected && !!threadId && !!user, 15000, reload);

  const role = user?.role === 'contractor' ? 'contractor' : 'customer';

  const openPaymentFlow = (paymentId?: string | null) => {
    pushOsNav(
      budgetTabRoute(role, 'payments', {
        openPayment: '1',
        ...(paymentId ? { paymentId } : {}),
      }),
      returnTo || pathname,
      role,
    );
  };

  if (loadFailed && !chat && user) {
    return (
      <View style={s.root}>
        <BackHeader title="Чат" returnTo={returnTo} />
        <View style={s.center}>
          <Text style={s.loadError}>Не удалось открыть чат. Сообщения не отмечены прочитанными.</Text>
          <PrimaryButton
            title="Повторить"
            onPress={() => {
              setLoadFailed(false);
              loadMessagesRef.current().catch(reportCatch('chat.loadMessages.retry'));
            }}
          />
        </View>
      </View>
    );
  }

  if (!chat || !user) {
    return (
      <View style={s.root}>
        <BackHeader title="Чат" returnTo={returnTo} />
        <View style={s.center}><Text>Загрузка…</Text></View>
      </View>
    );
  }

  const refreshChatAfterCommit = async (action: string) => {
    try {
      await loadMessages();
    } catch (error) {
      reportError(`ChatThreadView.${action}.ChatRefresh`, error, { threadId, projectId });
    }
  };

  const refreshProjectAfterCommit = async (action: string) => {
    try {
      const freshProject = await api.getProject(user.id, projectId);
      await syncProjectSideEffects({ user, project: freshProject });
    } catch (error) {
      reportError(`ChatThreadView.${action}.ProjectRefresh`, error, { threadId, projectId });
    }
  };

  const reconcileCommittedChatMutation = async (action: string) => {
    await refreshChatAfterCommit(action);
    if (hasProjectScope) await refreshProjectAfterCommit(action);
  };

  const canManage = canManageThread(user, chat.participants, chat.messages);
  const canLeave = canLeaveThread(user, chat.participants);
  const leaveRoute = `/(${role})/(tabs)/chat`;

  /** Один запрос на изменение за раз: busyRef закрывает двойной тап до перерисовки. */
  const runBusy = async (key: string, title: string, what: string, job: () => Promise<void>): Promise<boolean> => {
    if (busyRef.current) return false;
    busyRef.current = key;
    setBusyKey(key);
    try {
      await job();
      return true;
    } catch (e) {
      if (isOfflineQueued(e)) {
        notifyOfflineQueued(title);
        return false;
      }
      reportError(`ChatThreadView.${key}`, e, { threadId, projectId });
      notifyError(title, chatMutationError(e) ?? e, what);
      return false;
    } finally {
      busyRef.current = null;
      setBusyKey(null);
    }
  };

  const submitEdit = async () => {
    const target = editMsg;
    const body = editText.trim();
    if (!target || !body) return;
    if (body === (target.text ?? '').trim()) {
      setEditMsg(null);
      return;
    }
    const ok = await runBusy(`edit:${target.id}`, 'Сообщение не изменено', 'Не удалось сохранить изменения.', async () => {
      await api.editChatMessage(user.id, projectId, threadId, target.id, body);
    });
    if (ok) {
      setEditMsg(null);
      await refreshChatAfterCommit('EditMessage');
    }
  };

  const deleteMessage = async (target: ChatMessage) => {
    if (busyRef.current) return;
    const yes = await confirmAction({
      title: 'Удалить сообщение?',
      message: 'Участники увидят вместо него «Сообщение удалено». Вернуть текст будет нельзя.',
      confirmLabel: 'Удалить',
      destructive: true,
    });
    if (!yes) return;
    const ok = await runBusy(`delete:${target.id}`, 'Сообщение не удалено', 'Не удалось удалить сообщение.', async () => {
      await api.deleteChatMessage(user.id, projectId, threadId, target.id);
    });
    if (ok) await refreshChatAfterCommit('DeleteMessage');
  };

  const submitRename = async () => {
    const title = renameText.trim().replace(/\s+/g, ' ');
    if (!title) {
      notifyInfo('Название не изменено', 'Введите название чата.');
      return;
    }
    if (title === chat.title) {
      setRenameOpen(false);
      return;
    }
    const ok = await runBusy('rename', 'Название не изменено', 'Не удалось переименовать чат.', async () => {
      await api.renameChat(user.id, projectId, threadId, title);
    });
    if (ok) {
      setRenameOpen(false);
      await refreshChatAfterCommit('RenameChat');
    }
  };

  const archiveThread = async () => {
    if (busyRef.current) return;
    const yes = await confirmAction({
      title: 'Архивировать чат?',
      message: 'Чат уйдёт в архив у всех участников. Его можно открыть во вкладке «Архив» списка чатов.',
      confirmLabel: 'В архив',
    });
    if (!yes) return;
    const ok = await runBusy('archive', 'Чат не архивирован', 'Не удалось отправить чат в архив.', async () => {
      await api.archiveChat(user.id, projectId, threadId, true);
    });
    if (ok) goBack(leaveRoute, user.role);
  };

  const leaveThread = async () => {
    if (busyRef.current) return;
    const yes = await confirmAction({
      title: 'Покинуть чат?',
      message: 'Вы перестанете получать сообщения этого чата. Вернуться можно только по новому приглашению.',
      confirmLabel: 'Покинуть',
      destructive: true,
    });
    if (!yes) return;
    const ok = await runBusy('leave', 'Не удалось выйти из чата', 'Не удалось выйти из чата.', async () => {
      await api.leaveChat(user.id, projectId, threadId);
    });
    if (ok) goBack(leaveRoute, user.role);
  };

  const removeParticipant = async (participantId: string, name: string) => {
    if (busyRef.current) return;
    const yes = await confirmAction({
      title: 'Убрать участника?',
      message: `${name} перестанет видеть этот чат.`,
      confirmLabel: 'Убрать',
      destructive: true,
    });
    if (!yes) return;
    const ok = await runBusy(`remove:${participantId}`, 'Участник не убран', 'Не удалось убрать участника.', async () => {
      await api.removeChatParticipant(user.id, projectId, threadId, participantId);
    });
    if (ok) await refreshChatAfterCommit('RemoveParticipant');
  };

  const openThreadMenu = () => {
    showActionConfirm({
      title: chat.title,
      message: 'Действия с чатом',
      actions: [
        ...(canManage ? [{ label: 'Переименовать', onPress: () => { setRenameText(chat.title); setRenameOpen(true); } }] : []),
        ...(canManage ? [{ label: 'Архивировать', onPress: () => { void archiveThread(); } }] : []),
        { label: 'Участники', onPress: () => setSettingsOpen(true) },
        ...(canLeave ? [{ label: 'Покинуть чат', onPress: () => { void leaveThread(); }, destructive: true }] : []),
      ],
    });
  };

  const sendText = async (body: string, type = 'text', image?: string) => {
    const prefix = replyTo?.text ? `↩ ${replyTo.text.slice(0, 40)}…\n` : '';
    try {
      await api.sendChatMessage(user.id, projectId, threadId, prefix + body, type, image, replyTo?.id);
    } catch (e) {
      if (isOfflineQueued(e)) {
        notifyOfflineQueued('Сообщение');
        setReplyTo(null);
        return;
      }
      throw e;
    }
    setReplyTo(null);
    // Отправили из окна «вокруг найденного» — возвращаемся к последним, чтобы увидеть своё сообщение.
    anchorIdRef.current = null;
    setIsOffLatest(false);
    stickToBottomRef.current = true;
    await reconcileCommittedChatMutation('SendMessage');
  };

  return (
    <View style={s.root}>
      <BackHeader title={chat.title} returnTo={returnTo} />
      <View style={s.topActions}>
        <Text style={[s.wsDot, wsConnected ? s.wsOn : s.wsOff]}>{wsConnected ? '● онлайн' : '○ опрос 15 с'}</Text>
        {canManageParticipants && (
          <Pressable onPress={() => setInviteOpen(true)}><Text style={s.topLink}>+ Участник</Text></Pressable>
        )}
        <Pressable onPress={openThreadMenu} accessibilityRole="button" accessibilityLabel="Действия с чатом"><Text style={s.topLink}>Меню чата</Text></Pressable>
        <Pressable onPress={() => api.exportChatPdf(user.id, projectId, threadId).catch((err) => notifyError('Ошибка', err, 'Не удалось экспортировать документ'))}>
          <Text style={s.topLink}>Документ</Text>
        </Pressable>
        <Pressable onPress={async () => {
          try {
            await api.patchChatState(user.id, projectId, threadId, { is_pinned: !chat.is_pinned });
          } catch (e) {
            if (isOfflineQueued(e)) {
              notifyOfflineQueued(chat.is_pinned ? 'Открепление чата' : 'Закрепление чата');
              return;
            }
            reportError('ChatThreadView.ChatPin.Mutation', e, { threadId, projectId });
            notifyError('Ошибка', e, 'Не удалось изменить закрепление');
            return;
          }
          await refreshChatAfterCommit('ChatPin');
        }}>
          <Text style={s.topLink}>{chat.is_pinned ? 'Открепить чат' : 'Закрепить чат'}</Text>
        </Pressable>
      </View>
      <ChatInThreadSearch
        messages={chat.messages}
        onJump={(id) => { void jumpToMessage(id); }}
        onQueryChange={setChatQuery}
        fetchRemote={searchInThread}
      />
      {jumpFailed ? <Text style={s.wsHint}>Не удалось открыть найденное сообщение. Попробуйте ещё раз.</Text> : null}
      <ReadOnlyBanner />
      <ScrollView
        ref={scrollRef}
        style={s.wrap}
        contentContainerStyle={{ padding: 16 }}
        scrollEventThrottle={100}
        onScroll={(e: {
          nativeEvent: {
            contentOffset: { y: number };
            contentSize: { height: number };
            layoutMeasurement: { height: number };
          };
        }) => {
          const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
          stickToBottomRef.current = contentSize.height - (contentOffset.y + layoutMeasurement.height) < 160;
        }}
        onContentSizeChange={() => {
          const restoreId = restoreScrollToRef.current;
          if (restoreId) {
            // Подгрузили ранние: остаёмся на сообщении, которое было первым.
            restoreScrollToRef.current = null;
            setTimeout(() => {
              const y = layoutYRef.current[restoreId];
              if (y != null) scrollRef.current?.scrollTo({ y: Math.max(0, y - 8), animated: false });
            }, 60);
            return;
          }
          if (stickToBottomRef.current && !anchorIdRef.current) scrollRef.current?.scrollToEnd({ animated: false });
        }}
      >
        {canLoadEarlier(chat.has_more_before, chat.messages) ? (
          <View style={s.earlierWrap}>
            <PrimaryButton
              title={loadingEarlier ? 'Загрузка…' : earlierFailed ? 'Не удалось загрузить — повторить' : 'Загрузить ранние'}
              variant="outline"
              compact
              disabled={loadingEarlier}
              onPress={() => { void loadEarlier(); }}
            />
          </View>
        ) : null}
        {chat.messages.filter((m) => !isChatCreationSystemMessage(m)).map((m) => (
          <MessageBubble
            key={m.id}
            m={m}
            userId={user.id}
            onLayoutY={(y) => { layoutYRef.current[m.id] = y; }}
            mine={isMineMessage(m, user)}
            highlight={highlightId === m.id}
            query={chatQuery.trim() || undefined}
            returnTo={returnTo || `/chat/${threadId}`}
            osRole={role}
            canOpenProjectActions={canViewProjectActions}
            onReact={async (emoji) => {
              try {
                await api.reactChatMessage(user.id, projectId, threadId, m.id, emoji);
              } catch (e) {
                if (isOfflineQueued(e)) {
                  notifyOfflineQueued('Реакция');
                  return;
                }
                reportError('ChatThreadView.Reaction.Mutation', e, { threadId, projectId, messageId: m.id });
                notifyError('Ошибка', e, 'Не удалось поставить реакцию');
                return;
              }
              await refreshChatAfterCommit('Reaction');
            }}
            onPin={canManageParticipants ? async () => {
              try {
                await api.pinChatMessage(user.id, projectId, threadId, m.id, !m.is_pinned);
              } catch (e) {
                if (isOfflineQueued(e)) {
                  notifyOfflineQueued('Закрепление сообщения');
                  return;
                }
                reportError('ChatThreadView.MessagePin.Mutation', e, { threadId, projectId, messageId: m.id });
                notifyError('Ошибка', e, 'Не удалось изменить закрепление сообщения');
                return;
              }
              await refreshChatAfterCommit('MessagePin');
            } : undefined}
            onReply={() => setReplyTo(m)}
            actions={messageActions(m, user, { canPin: canManageParticipants, canWrite })}
            busy={busyKey !== null}
            onEdit={() => { setEditText(m.text ?? ''); setEditMsg(m); }}
            onDelete={() => { void deleteMessage(m); }}
            onTask={canCreateTask ? () => setTaskMsg(m) : undefined}
            onConfirm={canManageParticipants && m.message_type === 'confirm' && m.author_id !== user.id ? async () => {
              try {
                await api.confirmChatMessage(user.id, projectId, threadId, m.id);
              } catch (e) {
                if (isOfflineQueued(e)) {
                  notifyOfflineQueued('Подтверждение');
                  return;
                }
                reportError('ChatThreadView.Confirm.Mutation', e, { threadId, projectId, messageId: m.id });
                notifyError('Ошибка', e, 'Не удалось подтвердить сообщение');
                return;
              }
              await reconcileCommittedChatMutation('Confirm');
            } : undefined}
            repliedTo={m.reply_to_id ? chat.messages.find((x) => x.id === m.reply_to_id) ?? null : null}
            onOpenReplied={m.reply_to_id ? () => router.setParams({ highlightId: m.reply_to_id! }) : undefined}
            onPay={canViewProjectActions && m.message_type === 'payment' ? () => {
              const meta = (m as { meta?: { payment_id?: string }; payment_id?: string });
              openPaymentFlow(meta.meta?.payment_id || meta.payment_id);
            } : undefined}
          />
        ))}
        {isOffLatest ? (
          <View style={s.earlierWrap}>
            <PrimaryButton title="К последним сообщениям" variant="outline" compact onPress={backToLatest} />
          </View>
        ) : null}
      </ScrollView>

      {replyTo && (
        <View style={s.replyBar}>
          <Text style={s.replyText} numberOfLines={1}>Ответ: {replyTo.text}</Text>
          <Pressable onPress={() => setReplyTo(null)}><Text style={s.replyX}>✕</Text></Pressable>
        </View>
      )}

      <View style={s.composer}>
        {chat?.no_other_recipients && <Text style={s.wsHint}>Исполнитель ещё не подключён — сообщение увидят, когда он появится</Text>}
        {!wsConnected && <Text style={s.wsHint}>Нет live-соединения — обновление каждые 15 с (не «онлайн»)</Text>}
        {typing && <Text style={s.typing}>печатает…</Text>}
        <TextInput
          style={s.input}
          value={text}
          onChangeText={(v: string) => { setText(v); wsSend({ type: 'typing' }); }}
          placeholder="Сообщение…"
          editable={canWrite}
          multiline
        />
        <View style={s.composerRow}>
          <PrimaryButton disabled={!canWrite} title="Отправить" compact onPress={async () => {
            if (!text.trim()) return;
            const tmp = text.trim();
            setText('');
            try {
              await sendText(tmp);
            } catch (error) {
              setText(tmp);
              reportError('ChatThreadView.SendMessage.Mutation', error, { threadId, projectId });
              notifyError('Ошибка', error, 'Не удалось отправить сообщение');
            }
          }} />
          <Pressable
            disabled={!canWrite}
            accessibilityRole="button"
            accessibilityLabel="Прикрепить изображение: JPEG, PNG или WebP, до 10 МБ"
            onPress={async () => {
              // COM-004: только то, что принимает backend (JPEG/PNG/WebP ≤ 10 МБ); PDF/видео не предлагаем.
              const pick = await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.8, mediaTypes: ['images'] });
              if (pick.canceled || !pick.assets[0]) return;
              const a = pick.assets[0];
              const check = validateChatAttachment({
                mimeType: guessAttachmentMime(a),
                base64: a.base64,
                fileSize: a.fileSize,
              });
              if (!check.ok) {
                notifyInfo('Файл не отправлен', check.message);
                return;
              }
              try {
                await sendText('Фото', 'photo', chatAttachmentDataUrl(check.mimeType, a.base64 as string));
              } catch (error) {
                reportError('ChatThreadView.SendAttachment.Mutation', error, { threadId, projectId });
                notifyError('Ошибка', error, 'Не удалось отправить изображение');
              }
            }}
          ><Text style={s.toolBtn}>📷</Text></Pressable>
          {user.role === 'contractor' && (
            <>
              <Pressable disabled={!canWrite} onPress={() => {
                void sendText('Прошу подтвердить согласование', 'confirm').catch((error) => {
                  reportError('ChatThreadView.SendConfirm.Mutation', error, { threadId, projectId });
                  notifyError('Ошибка', error, 'Не удалось отправить запрос подтверждения');
                });
              }}>
                <Text style={s.toolBtn}>✓?</Text>
              </Pressable>
              {canCreateInvoice && (
                <Pressable disabled={!canWrite} onPress={() => {
                  const createInvoice = async (amount: number) => {
                    try {
                      await api.invoiceFromChat(user.id, projectId, threadId, {
                        title: 'Оплата работ',
                        amount,
                        payment_type: 'stage',
                      });
                    } catch (e: unknown) {
                      if (isOfflineQueued(e)) {
                        notifyOfflineQueued('Счёт');
                      } else {
                        reportError('ChatThreadView.Invoice.Mutation', e, { threadId, projectId, amount });
                        notifyError('Ошибка', e, 'Не удалось создать счёт');
                      }
                      return;
                    }
                    await reconcileCommittedChatMutation('Invoice');
                    alertChatInvoiceCreated(role === 'contractor' ? 'contractor' : 'customer', amount);
                  };
                  const openPaymentForm = () => {
                    const osRole = role === 'contractor' ? 'contractor' : 'customer';
                    pushOsNav(budgetTabRoute(osRole, 'payments', { openPayment: '1' }), returnTo || pathname, osRole);
                  };
                  showActionConfirm({
                    title: 'Счёт в бюджете',
                    message: 'Быстрая сумма или полная форма (сумма / этап / тип). Заказчик увидит счёт в «Деньги → Оплаты».',
                    actions: [
                      { label: '5 000 ₽', onPress: () => { createInvoice(5000).catch(reportCatch('chat.invoice')); } },
                      { label: '10 000 ₽', onPress: () => { createInvoice(10000).catch(reportCatch('chat.invoice')); } },
                      { label: '25 000 ₽', onPress: () => { createInvoice(25000).catch(reportCatch('chat.invoice')); } },
                      { label: 'Другая сумма…', onPress: openPaymentForm },
                      { label: 'Открыть оплаты', onPress: openPaymentForm },
                    ],
                  });
                }}><Text style={s.toolBtn}>💳</Text></Pressable>
              )}
            </>
          )}
        </View>
      </View>

      <Modal visible={settingsOpen} transparent animationType="slide">
        <View style={s.modalBg}>
          <View style={s.modal}>
            <Text style={s.modalTitle}>Настройки чата</Text>
            <View style={s.settingRow}>
              <Text style={s.settingLabel}>Объект</Text>
              <Text style={s.settingVal}>
                {chat.project_name || projects.find((p) => p.id === chat.project_id)?.name || '—'}
              </Text>
            </View>
            <Text style={s.hint}>Чат привязан к объекту при создании. Для другого объекта создайте новый чат.</Text>
            {chat.participants && chat.participants.length > 0 && (
              <>
                <Text style={s.settingLabel}>Участники</Text>
                {chat.participants.map((p) => {
                  const name = p.full_name || p.phone || p.profile_code || 'Участник';
                  const roleText = participantRoleLabel(p.role);
                  return (
                    <View key={p.id} style={s.participantRow}>
                      <Text style={s.participant}>
                        {name}
                        {p.user_id === user.id ? ' (вы)' : ''}
                        {roleText ? ` · ${roleText}` : ''}
                        {p.status === 'active' ? '' : ` · ${p.status}`}
                      </Text>
                      {canRemoveParticipant(canManage, user, p) ? (
                        <Pressable
                          disabled={busyKey !== null}
                          onPress={() => { void removeParticipant(p.id, name); }}
                          accessibilityRole="button"
                          accessibilityLabel={`Убрать участника ${name}`}
                          hitSlop={8}
                        >
                          <Text style={[s.topLink, busyKey !== null && s.disabledLink]}>Убрать</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  );
                })}
              </>
            )}
            <PrimaryButton title="Закрыть" variant="outline" onPress={() => setSettingsOpen(false)} />
          </View>
        </View>
      </Modal>

      <Modal visible={!!editMsg} transparent animationType="slide" onRequestClose={() => setEditMsg(null)}>
        <View style={s.modalBg}>
          <View style={s.modal}>
            <Text style={s.modalTitle}>Изменить сообщение</Text>
            <TextInput style={s.input} value={editText} onChangeText={setEditText} multiline autoFocus maxLength={8000} />
            <Text style={s.hint}>Свои текстовые сообщения можно менять в течение суток после отправки. У сообщения появится пометка «изменено».</Text>
            <PrimaryButton
              title={busyKey?.startsWith('edit:') ? 'Сохраняем…' : 'Сохранить'}
              disabled={busyKey !== null || !editText.trim()}
              onPress={() => { void submitEdit(); }}
            />
            <PrimaryButton title="Отмена" variant="outline" disabled={busyKey !== null} onPress={() => setEditMsg(null)} />
          </View>
        </View>
      </Modal>

      <Modal visible={renameOpen} transparent animationType="slide" onRequestClose={() => setRenameOpen(false)}>
        <View style={s.modalBg}>
          <View style={s.modal}>
            <Text style={s.modalTitle}>Название чата</Text>
            <TextInput style={s.input} value={renameText} onChangeText={setRenameText} autoFocus maxLength={255} placeholder="Название" />
            <PrimaryButton
              title={busyKey === 'rename' ? 'Сохраняем…' : 'Сохранить'}
              disabled={busyKey !== null || !renameText.trim()}
              onPress={() => { void submitRename(); }}
            />
            <PrimaryButton title="Отмена" variant="outline" disabled={busyKey !== null} onPress={() => setRenameOpen(false)} />
          </View>
        </View>
      </Modal>

      <Modal visible={canManageParticipants && inviteOpen} transparent animationType="slide">
        <View style={s.modalBg}>
          <View style={s.modal}>
            <Text style={s.modalTitle}>Пригласить в чат</Text>
            <TextInput style={s.input} value={inviteCode} onChangeText={setInviteCode} placeholder="Номер профиля (6 символов)" autoCapitalize="characters" />
            <Text style={s.or}>или</Text>
            <TextInput style={s.input} value={invitePhone} onChangeText={setInvitePhone} placeholder="Телефон +7…" keyboardType="phone-pad" />
            <Text style={s.hint}>Если участник ещё не зарегистрирован, Renova поставит SMS в надёжную очередь. Доставка подтверждается отдельно; после регистрации доступ будет только к этому чату.</Text>
            <PrimaryButton title="Пригласить" onPress={async () => {
              let inviteResult;
              try {
                inviteResult = await api.inviteToChat(user.id, projectId, threadId, {
                  phone: invitePhone || undefined,
                  profile_code: inviteCode || undefined,
                });
              } catch (error) {
                reportError('ChatThreadView.Invite.Mutation', error, { threadId, projectId });
                notifyError('Ошибка', error, 'Не удалось пригласить участника');
                return;
              }
              setInviteOpen(false);
              setInvitePhone('');
              setInviteCode('');
              await reconcileCommittedChatMutation('Invite');
              alertChatInviteSent((user.role === 'contractor' ? 'contractor' : 'customer'), {
                channel: inviteResult.delivery_channel,
                status: inviteResult.delivery_status,
              });
            }} />
            <PrimaryButton title="Закрыть" variant="outline" onPress={() => setInviteOpen(false)} />
          </View>
        </View>
      </Modal>

      <ChatTaskSheet
        visible={canCreateTask && !!taskMsg}
        defaultTitle={taskMsg?.text?.slice(0, 80) || 'Задача из чата'}
        userId={user.id}
        onClose={() => setTaskMsg(null)}
        onSubmit={async (body) => {
          if (!taskMsg || !canCreateTask) return;
          try {
            await api.taskFromChatMessage(user.id, projectId, threadId, taskMsg.id, body);
          } catch (e) {
            if (isOfflineQueued(e)) {
              notifyOfflineQueued('Задача из чата');
              setTaskMsg(null);
              return;
            }
            reportError('ChatThreadView.Task.Mutation', e, { threadId, projectId, messageId: taskMsg.id });
            throw e;
          }
          setTaskMsg(null);
          await reconcileCommittedChatMutation('Task');
          alertChatTaskCreated(role === 'contractor' ? 'contractor' : 'customer');
        }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: RenovaTheme.colors.background },
  wrap: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 24 },
  loadError: { textAlign: 'center', color: RenovaTheme.colors.textMuted },
  topActions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 4, gap: 8, rowGap: 4, flexWrap: 'wrap' },
  wsDot: { fontSize: 11, fontWeight: '700' },
  wsOn: { color: RenovaTheme.colors.success },
  wsOff: { color: RenovaTheme.colors.textMuted },
  topLink: { fontSize: 12, fontWeight: '600', color: RenovaTheme.colors.accent },
  msg: { padding: 10, borderRadius: 10, marginBottom: 8, maxWidth: '88%' },
  me: { alignSelf: 'flex-end', backgroundColor: '#dbeafe' },
  them: { alignSelf: 'flex-start', backgroundColor: RenovaTheme.colors.surface },
  highlight: { backgroundColor: '#fef9c3' },
  pinnedMsg: { borderWidth: 1, borderColor: RenovaTheme.colors.accent },
  pinTag: { fontSize: 10, color: RenovaTheme.colors.accent, fontWeight: '700', marginBottom: 2 },
  role: { fontSize: 10, color: RenovaTheme.colors.textMuted, marginBottom: 2 },
  time: { fontSize: 10, color: RenovaTheme.colors.textMuted, marginTop: 4, textAlign: 'right' },
  ok: { color: 'green', fontWeight: '600', marginTop: 4 },
  link: { color: RenovaTheme.colors.accent, fontWeight: '600', marginTop: 4 },
  file: { fontSize: 12, marginTop: 4, color: RenovaTheme.colors.text },
  earlierWrap: { alignItems: 'center', marginBottom: 12 },
  msgActions: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 6 },
  timeInRow: { flex: 1, marginTop: 0 },
  msgAction: { minWidth: 28, minHeight: 28, alignItems: 'center', justifyContent: 'center' },
  quote: { borderLeftWidth: 3, borderLeftColor: RenovaTheme.colors.accent, paddingLeft: 8, marginBottom: 6, opacity: 0.85 },
  quoteRole: { fontSize: 10, color: RenovaTheme.colors.accent, fontWeight: '700' },
  quoteText: { fontSize: 12, color: RenovaTheme.colors.textMuted },
  reactions: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 6 },
  reactChip: { backgroundColor: '#f1f5f9', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 2 },
  reactText: { fontSize: 12 },
  composer: { padding: 12, backgroundColor: RenovaTheme.colors.surface, borderTopWidth: 1, borderTopColor: RenovaTheme.colors.border, gap: 8 },
  composerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  toolBtn: { fontSize: 20, padding: 4 },
  typing: { fontSize: 11, color: '#999' },
  wsHint: { fontSize: 10, color: RenovaTheme.colors.warning, marginBottom: 4 },
  input: { minHeight: 44, borderWidth: 1, borderColor: RenovaTheme.colors.border, borderRadius: 8, padding: 10 },
  replyBar: { flexDirection: 'row', alignItems: 'center', padding: 8, backgroundColor: '#f1f5f9', gap: 8 },
  replyText: { flex: 1, fontSize: 12, color: RenovaTheme.colors.textMuted },
  replyX: { fontSize: 16, padding: 4 },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modal: { backgroundColor: RenovaTheme.colors.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, gap: 10 },
  modalTitle: { fontSize: 18, fontWeight: '700' },
  or: { textAlign: 'center', color: RenovaTheme.colors.textMuted, fontSize: 12 },
  hint: { fontSize: 11, color: RenovaTheme.colors.textMuted },
  systemWrap: { alignSelf: 'center', maxWidth: '90%', marginBottom: 8, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#f1f5f9', borderRadius: 12 },
  systemText: { fontSize: 12, color: RenovaTheme.colors.textMuted, textAlign: 'center' },
  systemTime: { fontSize: 10, color: RenovaTheme.colors.textSubtle, textAlign: 'center', marginTop: 2 },
  settingRow: { marginBottom: 8 },
  settingLabel: { ...screenTypography.section, marginTop: 4, marginBottom: 0 },
  settingVal: { fontSize: 15, fontWeight: '600', color: RenovaTheme.colors.text, marginTop: 4 },
  participant: { fontSize: 13, color: RenovaTheme.colors.text, paddingVertical: 4, flexShrink: 1 },
  participantRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  disabledLink: { opacity: 0.4 },
  deletedText: { fontSize: 14, fontStyle: 'italic', color: RenovaTheme.colors.textMuted },
  edited: { fontSize: 11, color: RenovaTheme.colors.textMuted, marginTop: 2 },
});