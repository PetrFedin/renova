/** Экран треда: реакции, закрепление, задачи, счета, участники, файлы */
import { useEffect, useRef, useState, useCallback } from 'react';
import {
  ScrollView, View, Text, TextInput, StyleSheet, Image, Pressable, Alert, Modal, AppState,
  type AppStateStatus,
} from 'react-native';
import { useFocusEffect, usePathname } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { RenovaTheme } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { BackHeader } from '@/components/renova/BackHeader';
import { ChatInThreadSearch } from '@/components/renova/ChatInThreadSearch';
import { HighlightText } from '@/components/renova/HighlightText';
import { ReadOnlyBanner, useWriteAllowed } from '@/components/renova/ReadOnlyGuard';
import { reportError, reportCatch } from '@/lib/reportError';
import { api, ChatDetail, ChatMessage, ApiError } from '@/lib/api';
import { threadsFromChatInbox } from '@/lib/domain/chatUnreadSnapshot';
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
import { router } from 'expo-router';
import {
  evaluateCanMarkChatRead,
  shouldFireMarkRead,
} from '@/lib/domain/canMarkChatRead';

const REACTIONS = ['👍', '✅', '❤️', '🔥', '❓'];

function MessageBubble({
  m,
  mine,
  highlight,
  query,
  returnTo,
  osRole,
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
  onReact: (emoji: string) => void;
  onPin: () => void;
  onReply: () => void;
  onTask: () => void;
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
        Alert.alert('Сообщение', undefined, [
          ...REACTIONS.map((e) => ({ text: e, onPress: () => onReact(e) })),
          { text: m.is_pinned ? 'Открепить' : 'Закрепить', onPress: onPin },
          { text: 'Ответить', onPress: onReply },
          { text: 'Создать задачу', onPress: onTask },
          { text: 'Отмена', style: 'cancel' },
        ]);
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
      {m.work_order_id && (
        <Pressable
          onPress={() =>
            // W119: WO из чата → pushOsNav SoT
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
  projectId: projectIdProp,
  returnTo,
  highlightId,
}: {
  threadId: string;
  projectId?: string;
  returnTo?: string;
  highlightId?: string;
}) {
  const pathname = usePathname();
  const { user, activeProject, projects, loadProject } = useRenova();
  const canWrite = useWriteAllowed();
  const syncAfterRead = useChatReadSync(user?.id, user?.role);
  const [chat, setChat] = useState<ChatDetail | null>(null);
  const [chatProjectId, setChatProjectId] = useState<string | null>(projectIdProp ?? null);
  const loadGenRef = useRef(0);
  const loadedThreadRef = useRef<string | null>(null);
  const canMarkPrevRef = useRef(false);
  const [screenFocused, setScreenFocused] = useState(false);
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);
  const [threadLoaded, setThreadLoaded] = useState(false);
  const [accessConfirmed, setAccessConfirmed] = useState(false);
  const [latestMessagesRendered, setLatestMessagesRendered] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
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

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => setAppState(next));
    return () => sub.remove();
  }, []);

  const resolveProjectId = useCallback(async (): Promise<string | null> => {
    if (projectIdProp) return projectIdProp;
    if (chatProjectId) return chatProjectId;
    if (!user) return null;
    if (activeProject?.id) {
      try {
        // GET больше не mark-read — безопасный probe доступа
        await api.getChat(user.id, activeProject.id, threadId);
        return activeProject.id;
      } catch {
        /* чат на другом объекте */
      }
    }
    try {
      const inbox = await api.chatInbox(user.id);
      return threadsFromChatInbox(inbox).find((t) => t.id === threadId)?.project_id
        ?? activeProject?.id
        ?? null;
    } catch (e) {
      reportError('chat.resolveProjectId.inbox', e, { threadId });
      return activeProject?.id ?? null;
    }
  }, [user, activeProject?.id, threadId, projectIdProp, chatProjectId]);

  const loadMessages = useCallback(async () => {
    if (!user || !threadId) return;
    const gen = ++loadGenRef.current;
    const projectId = await resolveProjectId();
    if (gen !== loadGenRef.current) return;
    if (!projectId) {
      setLoadFailed(true);
      setAccessConfirmed(false);
      setThreadLoaded(false);
      return;
    }
    setChatProjectId((prev) => (prev === projectId ? prev : projectId));
    if (activeProject?.id !== projectId) {
      await loadProject(projectId).catch((e) => reportError('chat.loadProject', e, { projectId }));
    }
    if (gen !== loadGenRef.current) return;
    try {
      const detail = await api.getChat(user.id, projectId, threadId);
      if (gen !== loadGenRef.current) return;
      loadedThreadRef.current = threadId;
      setChat(detail);
      setAccessConfirmed(true);
      setThreadLoaded(true);
      setLoadFailed(false);
      setLatestMessagesRendered(false);
    } catch (e) {
      if (gen !== loadGenRef.current) return;
      setLoadFailed(true);
      setAccessConfirmed(false);
      setThreadLoaded(false);
      setLatestMessagesRendered(false);
      const status = e instanceof ApiError ? e.status : 0;
      if (status === 403 || status === 404) {
        reportError('chat.loadMessages.acl', e, { threadId, status });
      } else {
        reportError('chat.loadMessages', e, { threadId });
      }
      throw e;
    }
  }, [user, threadId, resolveProjectId, activeProject?.id, loadProject]);

  const markThreadReadLocal = useCallback(async (forcedProjectId?: string | null) => {
    if (!user || !threadId) return;
    if (loadedThreadRef.current !== threadId) return;
    const projectId = forcedProjectId ?? projectIdProp ?? chatProjectId ?? (await resolveProjectId());
    if (!projectId) return;

    const last = chat?.messages?.length
      ? [...chat.messages].sort((a, b) => a.created_at.localeCompare(b.created_at)).slice(-1)[0]
      : null;

    // Единый store action — dedupe / skip_same / skip_stale внутри
    await syncAfterRead(
      projectId,
      threadId,
      0,
      last?.id ?? null,
      last?.created_at ?? null,
      'thread_visible',
    );
  }, [user, threadId, projectIdProp, chatProjectId, resolveProjectId, syncAfterRead, chat]);

  const loadMessagesRef = useRef(loadMessages);
  const markThreadReadRef = useRef(markThreadReadLocal);
  loadMessagesRef.current = loadMessages;
  markThreadReadRef.current = markThreadReadLocal;

  useFocusEffect(
    useCallback(() => {
      setScreenFocused(true);
      canMarkPrevRef.current = false;
      setThreadLoaded(false);
      setAccessConfirmed(false);
      setLatestMessagesRendered(false);
      setLoadFailed(false);
      loadMessagesRef.current().catch(reportCatch('chat.loadMessages'));
      return () => {
        setScreenFocused(false);
        canMarkPrevRef.current = false;
      };
    }, [threadId, projectIdProp]),
  );

  useEffect(() => {
    canMarkPrevRef.current = false;
    loadedThreadRef.current = null;
    setChat(null);
    setThreadLoaded(false);
    setAccessConfirmed(false);
    setLatestMessagesRendered(false);
    setLoadFailed(false);
  }, [threadId, projectIdProp]);

  // Сообщения отрисованы (включая пустой тред)
  useEffect(() => {
    if (!threadLoaded || !accessConfirmed || !chat) return;
    let cancelled = false;
    const id = requestAnimationFrame(() => {
      if (!cancelled) setLatestMessagesRendered(true);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
    };
  }, [threadLoaded, accessConfirmed, chat, threadId]);

  const canMarkRead = evaluateCanMarkChatRead({
    screenFocused,
    appForeground: appState === 'active',
    threadLoaded,
    accessConfirmed,
    latestMessagesRendered,
    loadFailed,
    threadMatches: loadedThreadRef.current === threadId,
  });

  useEffect(() => {
    const prev = canMarkPrevRef.current;
    canMarkPrevRef.current = canMarkRead;
    if (!shouldFireMarkRead(prev, canMarkRead)) return;
    markThreadReadRef.current().catch(reportCatch('chat.markRead'));
  }, [canMarkRead, threadId]);

  useEffect(() => {
    if (highlightId && chat?.messages.length) {
      const idx = chat.messages.findIndex((m) => m.id === highlightId);
      if (idx >= 0) setTimeout(() => scrollRef.current?.scrollTo({ y: idx * 72, animated: true }), 400);
    }
  }, [highlightId, chat?.messages.length]);

  const reload = useCallback(() => loadMessages().catch(reportCatch('chat.reload')), [loadMessages]);
  useProjectDataReload(reload);

  const { send: wsSend, connected: wsConnected } = useChatWebSocket(threadId, !!user && !!(chatProjectId || activeProject), (payload) => {
    if (payload.type === 'typing') {
      setTyping(true);
      setTimeout(() => setTyping(false), 2000);
      return;
    }
    // Новое сообщение: перезагрузка; mark-read через canMarkRead → store.markThreadRead
    canMarkPrevRef.current = false;
    setLatestMessagesRendered(false);
    reload();
  });

  useChatFallbackPoll(!wsConnected && !!threadId && !!user, 15000, reload);

  const role = user?.role === 'contractor' ? 'contractor' : 'customer';

  const openPaymentFlow = (paymentId?: string | null) => {
    // Канон: финансы только через Budget → PaymentDetailSheet, не через chat confirm
    pushOsNav(
      budgetTabRoute(role, 'payments', {
        openPayment: '1',
        ...(paymentId ? { paymentId } : {}),
      }),
      returnTo || pathname,
      role,
    );
  };

  if (loadFailed && !chat) {
    return (
      <View style={s.root}>
        <BackHeader title="Чат" returnTo={returnTo} />
        <View style={s.center}>
          <Text style={{ textAlign: 'center', color: RenovaTheme.colors.textMuted }}>
            Не удалось открыть чат. Сообщения не отмечены прочитанными.
          </Text>
          <PrimaryButton title="Повторить" onPress={() => loadMessages().catch(reportCatch('chat.retry'))} />
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

  const projectId = chatProjectId ?? chat.project_id ?? activeProject?.id;
  if (!projectId) {
    return (
      <View style={s.root}>
        <BackHeader title="Чат" returnTo={returnTo} />
        <View style={s.center}><Text>Чат не привязан к объекту</Text></View>
      </View>
    );
  }

  const sendText = async (body: string, type = 'text', image?: string) => {
    const prefix = replyTo?.text ? `↩ ${replyTo.text.slice(0, 40)}…\n` : '';
    try {
      await api.sendChatMessage(user.id, projectId, threadId, prefix + body, type, image, replyTo?.id);
    } catch (e) {
      if (isOfflineQueued(e)) { notifyOfflineQueued('Сообщение'); return; }
      throw e;
    } finally {
      setReplyTo(null);
      await reload();
    }
  };

  return (
    <View style={s.root}>
      <BackHeader title={chat.title} returnTo={returnTo} />
      <View style={s.topActions}>
        <Text style={[s.wsDot, wsConnected ? s.wsOn : s.wsOff]}>{wsConnected ? '● онлайн' : '○ опрос 15 с'}</Text>
        <Pressable onPress={() => setInviteOpen(true)}><Text style={s.topLink}>+ Участник</Text></Pressable>
        <Pressable onPress={() => setSettingsOpen(true)}><Text style={s.topLink}>Настройки</Text></Pressable>
        <Pressable onPress={() => api.exportChatPdf(user.id, projectId, threadId).catch(() => Alert.alert('Ошибка', 'Не удалось экспортировать документ'))}>
          <Text style={s.topLink}>Документ</Text>
        </Pressable>
        <Pressable onPress={async () => {
          try {
            await api.patchChatState(user.id, projectId, threadId, { is_pinned: !chat.is_pinned });
            await reload();
          } catch (e) {
            if (isOfflineQueued(e)) { notifyOfflineQueued(chat.is_pinned ? 'Открепление чата' : 'Закрепление чата'); return; }
            Alert.alert('Ошибка', 'Не удалось изменить закрепление');
          }
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
            onReact={async (emoji) => {
              try {
                await api.reactChatMessage(user.id, projectId, threadId, m.id, emoji);
                await reload();
              } catch (e) {
                if (isOfflineQueued(e)) { notifyOfflineQueued('Реакция'); return; }
              }
            }}
            onPin={async () => {
              try {
                await api.pinChatMessage(user.id, projectId, threadId, m.id, !m.is_pinned);
                await reload();
              } catch (e) {
                if (isOfflineQueued(e)) { notifyOfflineQueued('Закрепление сообщения'); return; }
              }
            }}
            onReply={() => setReplyTo(m)}
            onTask={() => setTaskMsg(m)}
            onConfirm={m.message_type === 'confirm' ? async () => {
              try {
                await api.confirmChatMessage(user.id, projectId, threadId, m.id);
                await reload();
                await syncProjectSideEffects({ user, project: activeProject ?? ({ id: projectId } as any) });
              } catch (e) {
                if (isOfflineQueued(e)) {
                  notifyOfflineQueued('Подтверждение');
                  return;
                }
                throw e;
              }
            } : undefined}
            onPay={m.message_type === 'payment' ? () => {
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
          onChangeText={(v) => { setText(v); wsSend({ type: 'typing' }); }}
          placeholder="Сообщение…"
          editable={canWrite}
          multiline
        />
        <View style={s.composerRow}>
          <PrimaryButton disabled={!canWrite} title="Отправить" compact onPress={async () => {
            if (!text.trim()) return;
            const tmp = text.trim();
            setText('');
            await sendText(tmp);
          }} />
          <Pressable disabled={!canWrite} onPress={async () => {
            const pick = await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.6 });
            if (pick.canceled || !pick.assets[0]?.base64) return;
            await sendText('Фото', 'photo', compressDataUrl(`data:image/jpeg;base64,${pick.assets[0].base64}`));
          }}><Text style={s.toolBtn}>📷</Text></Pressable>
          <Pressable disabled={!canWrite} onPress={async () => {
            const pick = await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.8, mediaTypes: ImagePicker.MediaTypeOptions.All });
            if (pick.canceled || !pick.assets[0]?.base64) return;
            const a = pick.assets[0];
            const isPhoto = (a.mimeType || '').startsWith('image/');
            await sendText(a.fileName || (isPhoto ? 'Фото' : 'Файл'), isPhoto ? 'photo' : 'file', compressDataUrl(`data:${a.mimeType || 'image/jpeg'};base64,${a.base64}`));
          }}><Text style={s.toolBtn}>📎</Text></Pressable>
          {user.role === 'contractor' && (
            <>
              <Pressable disabled={!canWrite} onPress={() => sendText('Прошу подтвердить согласование', 'confirm')}>
                <Text style={s.toolBtn}>✓?</Text>
              </Pressable>
              <Pressable disabled={!canWrite} onPress={() => {
                // W104: сумма на выбор → Payment в Бюджете (не hardcoded 10k)
                const createInvoice = async (amount: number) => {
                  try {
                    await api.invoiceFromChat(user.id, projectId, threadId, {
                      title: 'Оплата работ',
                      amount,
                      payment_type: 'stage',
                    });
                    await reload();
                    await syncProjectSideEffects({ user, project: activeProject ?? ({ id: projectId } as any) });
                    // W131: счёт из чата — роль-aware оплаты
                    alertChatInvoiceCreated(role === 'contractor' ? 'contractor' : 'customer', amount);
                  } catch (e: unknown) {
                    if (e instanceof Error && e.message === 'offline_queued') {
                      Alert.alert('Офлайн', 'Счёт отправится при подключении');
                    } else {
                      Alert.alert('Ошибка', 'Не удалось создать счёт');
                    }
                  }
                };
                const openPaymentForm = () => {
                  const osRole = role === 'contractor' ? 'contractor' : 'customer';
                  pushOsNav(budgetTabRoute(osRole, 'payments', { openPayment: '1' }), returnTo || pathname, osRole);
                };
                Alert.alert('Счёт в бюджете', 'Быстрая сумма или полная форма (сумма / этап / тип). Заказчик увидит счёт в «Деньги → Оплаты».', [
                  { text: 'Отмена', style: 'cancel' },
                  { text: '5 000 ₽', onPress: () => { createInvoice(5000).catch(reportCatch('chat.invoice')); } },
                  { text: '10 000 ₽', onPress: () => { createInvoice(10000).catch(reportCatch('chat.invoice')); } },
                  { text: '25 000 ₽', onPress: () => { createInvoice(25000).catch(reportCatch('chat.invoice')); } },
                  { text: 'Другая сумма…', onPress: openPaymentForm },
                  { text: 'Открыть оплаты', onPress: openPaymentForm },
                ]);
              }}><Text style={s.toolBtn}>💳</Text></Pressable>
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

      <Modal visible={inviteOpen} transparent animationType="slide">
        <View style={s.modalBg}>
          <View style={s.modal}>
            <Text style={s.modalTitle}>Пригласить в чат</Text>
            <TextInput style={s.input} value={inviteCode} onChangeText={setInviteCode} placeholder="Номер профиля (6 символов)" autoCapitalize="characters" />
            <Text style={s.or}>или</Text>
            <TextInput style={s.input} value={invitePhone} onChangeText={setInvitePhone} placeholder="Телефон +7…" keyboardType="phone-pad" />
            <Text style={s.hint}>На телефон придёт SMS: установите Renova и зарегистрируйтесь — чат появится в Сообщениях.</Text>
            <PrimaryButton title="Пригласить" onPress={async () => {
              await api.inviteToChat(user.id, projectId, threadId, {
                phone: invitePhone || undefined,
                profile_code: inviteCode || undefined,
              });
              setInviteOpen(false);
              setInvitePhone('');
              setInviteCode('');
              await reload();
              alertChatInviteSent((user.role === 'contractor' ? 'contractor' : 'customer'));
            }} />
            <PrimaryButton title="Закрыть" variant="outline" onPress={() => setInviteOpen(false)} />
          </View>
        </View>
      </Modal>

      <ChatTaskSheet
        visible={!!taskMsg}
        defaultTitle={taskMsg?.text?.slice(0, 80) || 'Задача из чата'}
        userId={user.id}
        onClose={() => setTaskMsg(null)}
        onSubmit={async (body) => {
          if (!taskMsg) return;
          try {
            await api.taskFromChatMessage(user.id, projectId, threadId, taskMsg.id, body);
            setTaskMsg(null);
            await reload();
            // W98/W131: календарь / работы / inbox после задачи из чата
            await syncProjectSideEffects({ user, project: activeProject ?? ({ id: projectId } as any) });
            alertChatTaskCreated(role === 'contractor' ? 'contractor' : 'customer');
          } catch (e) {
            if (isOfflineQueued(e)) {
              notifyOfflineQueued('Задача из чата');
              setTaskMsg(null);
              return;
            }
            throw e;
          }
        }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: RenovaTheme.colors.background },
  wrap: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
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
  settingLabel: { fontSize: 11, fontWeight: '700', color: RenovaTheme.colors.textMuted, textTransform: 'uppercase', marginTop: 4 },
  settingVal: { fontSize: 15, fontWeight: '600', color: RenovaTheme.colors.text, marginTop: 4 },
  participant: { fontSize: 13, color: RenovaTheme.colors.text, paddingVertical: 4 },
});
