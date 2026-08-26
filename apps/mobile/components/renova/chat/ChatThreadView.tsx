/** Экран треда: реакции, закрепление, задачи, счета, участники, файлы */
import { useEffect, useRef, useState, useCallback } from 'react';
import {
  AppState, ScrollView, View, Text, TextInput, StyleSheet, Image, Pressable, Alert, Modal,
} from 'react-native';
import { useFocusEffect, usePathname } from 'expo-router';
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
import { compressDataUrl } from '@/lib/compressImage';
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
import { router } from 'expo-router';

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
}: {
  m: ChatMessage;
  mine: boolean;
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
}) {
  const roleLabel = m.author_role === 'customer' ? 'Заказчик' : m.author_role === 'contractor' ? 'Исполнитель' : 'Система';
  const isSystem = m.author_role === 'system' || m.message_type === 'system';

  if (isSystem) {
    return (
      <View style={s.systemWrap}>
        <Text style={s.systemText}>{m.text}</Text>
        <Text style={s.systemTime}>{m.created_at.slice(11, 16)}</Text>
      </View>
    );
  }

  return (
    <Pressable
      style={[s.msg, mine ? s.me : s.them, highlight && s.highlight, m.is_pinned && s.pinnedMsg]}
      onLongPress={() => {
        showActionConfirm({
          title: 'Сообщение',
          message: 'Реакция или действие',
          actions: [
            ...REACTIONS.map((e) => ({ label: e, onPress: () => onReact(e) })),
            ...(onPin ? [{ label: m.is_pinned ? 'Открепить' : 'Закрепить', onPress: onPin }] : []),
            { label: 'Ответить', onPress: onReply },
            ...(onTask ? [{ label: 'Создать задачу', onPress: onTask }] : []),
          ],
        });
      }}
    >
      {m.is_pinned ? <Text style={s.pinTag}>📌 Закреплено</Text> : null}
      <Text style={s.role}>{roleLabel}</Text>
      {m.text && <HighlightText text={m.text} query={query} />}
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
      {m.image_url && <Image source={{ uri: m.image_url }} style={s.img} />}
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
      <Text style={s.time}>
        {m.created_at.slice(11, 16)}{mine && m.read ? ' ✓✓' : ''}
      </Text>
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
  const scrollRef = useRef<ScrollView>(null);
  const loadGenerationRef = useRef(0);
  const hasProjectScope = chat?.capabilities?.access_scope === 'project';
  const canViewProjectActions = hasProjectScope && chat?.capabilities?.can_view_project_actions === true;
  const canManageParticipants = hasProjectScope && chat?.capabilities?.can_manage_participants === true;
  const canCreateTask = hasProjectScope && chat?.capabilities?.can_create_task === true;
  const canCreateInvoice = hasProjectScope && chat?.capabilities?.can_create_invoice === true;

  const loadMessages = useCallback(async () => {
    if (!user || !threadId || !projectId) return;
    const generation = ++loadGenerationRef.current;
    try {
      const detail = await api.getChat(user.id, projectId, threadId);
      if (generation !== loadGenerationRef.current) return;
      if (detail.capabilities?.access_scope === 'project' && activeProject?.id !== projectId) {
        await loadProject(projectId).catch((error) => reportError('chat.loadProject', error, { projectId }));
        if (generation !== loadGenerationRef.current) return;
      }
      setRenderedReadCursor(null);
      setChat(detail);
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

  const overlayBlocking = (canManageParticipants && inviteOpen) || settingsOpen || (canCreateTask && !!taskMsg);

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

  useEffect(() => {
    if (highlightId && chat?.messages.length) {
      const idx = chat.messages.findIndex((m) => m.id === highlightId);
      if (idx >= 0) setTimeout(() => scrollRef.current?.scrollTo({ y: idx * 72, animated: true }), 400);
    }
  }, [highlightId, chat?.messages.length]);

  const reload = useCallback(() => loadMessages().catch(reportCatch('chat.reload')), [loadMessages]);
  useProjectDataReload(reload);

  const { send: wsSend, connected: wsConnected } = useChatWebSocket(threadId, !!user && !!projectId, (payload) => {
    if (payload.type === 'typing') {
      setTyping(true);
      setTimeout(() => setTyping(false), 2000);
      return;
    }
    // Delivery is not reading. Reload first; visibility+render gate decides later.
    reload();
  });

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
        <Pressable onPress={() => setSettingsOpen(true)}><Text style={s.topLink}>Настройки</Text></Pressable>
        <Pressable onPress={() => api.exportChatPdf(user.id, projectId, threadId).catch(() => Alert.alert('Ошибка', 'Не удалось экспортировать документ'))}>
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
            Alert.alert('Ошибка', 'Не удалось изменить закрепление');
            return;
          }
          await refreshChatAfterCommit('ChatPin');
        }}>
          <Text style={s.topLink}>{chat.is_pinned ? 'Открепить чат' : 'Закрепить чат'}</Text>
        </Pressable>
      </View>
      <ChatInThreadSearch messages={chat.messages} onJump={(id) => router.setParams({ highlightId: id })} onQueryChange={setChatQuery} />
      <ReadOnlyBanner />
      <ScrollView ref={scrollRef} style={s.wrap} contentContainerStyle={{ padding: 16 }}>
        {chat.messages.filter((m) => !isChatCreationSystemMessage(m)).map((m) => (
          <MessageBubble
            key={m.id}
            m={m}
            mine={m.author_role === user.role}
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
                Alert.alert('Ошибка', 'Не удалось поставить реакцию');
                return;
              }
              await refreshChatAfterCommit('Reaction');
            }}
            onPin={hasProjectScope ? async () => {
              try {
                await api.pinChatMessage(user.id, projectId, threadId, m.id, !m.is_pinned);
              } catch (e) {
                if (isOfflineQueued(e)) {
                  notifyOfflineQueued('Закрепление сообщения');
                  return;
                }
                reportError('ChatThreadView.MessagePin.Mutation', e, { threadId, projectId, messageId: m.id });
                Alert.alert('Ошибка', 'Не удалось изменить закрепление сообщения');
                return;
              }
              await refreshChatAfterCommit('MessagePin');
            } : undefined}
            onReply={() => setReplyTo(m)}
            onTask={canCreateTask ? () => setTaskMsg(m) : undefined}
            onConfirm={hasProjectScope && m.message_type === 'confirm' ? async () => {
              try {
                await api.confirmChatMessage(user.id, projectId, threadId, m.id);
              } catch (e) {
                if (isOfflineQueued(e)) {
                  notifyOfflineQueued('Подтверждение');
                  return;
                }
                reportError('ChatThreadView.Confirm.Mutation', e, { threadId, projectId, messageId: m.id });
                Alert.alert('Ошибка', 'Не удалось подтвердить сообщение');
                return;
              }
              await reconcileCommittedChatMutation('Confirm');
            } : undefined}
            onPay={canViewProjectActions && m.message_type === 'payment' ? () => {
              const meta = (m as { meta?: { payment_id?: string }; payment_id?: string });
              openPaymentFlow(meta.meta?.payment_id || meta.payment_id);
            } : undefined}
          />
        ))}
      </ScrollView>

      {replyTo && (
        <View style={s.replyBar}>
          <Text style={s.replyText} numberOfLines={1}>Ответ: {replyTo.text}</Text>
          <Pressable onPress={() => setReplyTo(null)}><Text style={s.replyX}>✕</Text></Pressable>
        </View>
      )}

      <View style={s.composer}>
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
              Alert.alert('Ошибка', 'Не удалось отправить сообщение');
            }
          }} />
          <Pressable disabled={!canWrite} onPress={async () => {
            const pick = await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.6 });
            if (pick.canceled || !pick.assets[0]?.base64) return;
            try {
              await sendText('Фото', 'photo', compressDataUrl(`data:image/jpeg;base64,${pick.assets[0].base64}`));
            } catch (error) {
              reportError('ChatThreadView.SendPhoto.Mutation', error, { threadId, projectId });
              Alert.alert('Ошибка', 'Не удалось отправить фото');
            }
          }}><Text style={s.toolBtn}>📷</Text></Pressable>
          <Pressable disabled={!canWrite} onPress={async () => {
            const pick = await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.8, mediaTypes: ImagePicker.MediaTypeOptions.All });
            if (pick.canceled || !pick.assets[0]?.base64) return;
            const a = pick.assets[0];
            const isPhoto = (a.mimeType || '').startsWith('image/');
            try {
              await sendText(a.fileName || (isPhoto ? 'Фото' : 'Файл'), isPhoto ? 'photo' : 'file', compressDataUrl(`data:${a.mimeType || 'image/jpeg'};base64,${a.base64}`));
            } catch (error) {
              reportError('ChatThreadView.SendAttachment.Mutation', error, { threadId, projectId });
              Alert.alert('Ошибка', 'Не удалось отправить файл');
            }
          }}><Text style={s.toolBtn}>📎</Text></Pressable>
          {user.role === 'contractor' && (
            <>
              <Pressable disabled={!canWrite} onPress={() => {
                void sendText('Прошу подтвердить согласование', 'confirm').catch((error) => {
                  reportError('ChatThreadView.SendConfirm.Mutation', error, { threadId, projectId });
                  Alert.alert('Ошибка', 'Не удалось отправить запрос подтверждения');
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
                        Alert.alert('Ошибка', 'Не удалось создать счёт');
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
                {chat.participants.map((p) => (
                  <Text key={p.id} style={s.participant}>
                    {p.full_name || p.phone || p.profile_code || 'Участник'}
                    {p.status === 'active' ? '' : ` · ${p.status}`}
                  </Text>
                ))}
              </>
            )}
            <PrimaryButton title="Закрыть" variant="outline" onPress={() => setSettingsOpen(false)} />
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
                Alert.alert('Ошибка', 'Не удалось пригласить участника');
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
  topActions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 4, gap: 8, flexWrap: 'wrap' },
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
  img: { width: 200, height: 140, borderRadius: 8, marginTop: 6 },
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
  participant: { fontSize: 13, color: RenovaTheme.colors.text, paddingVertical: 4 },
});