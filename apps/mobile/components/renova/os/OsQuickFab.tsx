/** Единая точка «+» — расход (scan/manual) · работа · чат */
import { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Modal, Platform, TextInput } from 'react-native';
import { router, usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { RenovaTheme } from '@/constants/Theme';
import { useRenova } from '@/lib/context/RenovaContext';
import { api } from '@/lib/api';
import { useNavFromHere } from '@/lib/navigation';
import { createProjectChat } from '@/lib/createProjectChat';
import { CreateWorkSheet } from '@/components/renova/CreateWorkSheet';
import { tabsPrefix, budgetTabHref, objectTabHref, repairTabRoute, type OsRole } from '@/constants/osSections';
import { pushOsNav } from '@/lib/pushOsNav';
import { useDetailLevel } from '@/lib/useDetailLevel';
import { fabActionIdsForLevel } from '@/lib/detailLevelPolicy';

type Action = { id: string; label: string; sub: string; icon: keyof typeof Ionicons.glyphMap; run: () => void };

export function OsQuickFab({ role }: { role: OsRole }) {
  const { user, activeProject, readOnly, loadProject } = useRenova();
  const pathname = usePathname();
  const nav = useNavFromHere();
  const detailLevel = useDetailLevel();
  const [open, setOpen] = useState(false);
  const [showWork, setShowWork] = useState(false);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatTitle, setChatTitle] = useState('Вопрос по ремонту');

  /** Контекст room/stage — предзаполнение scan и ручного расхода */
  const expenseContext = useMemo(() => {
    const roomMatch = pathname.match(/\/room\/([^/?]+)/);
    const stageMatch = pathname.match(/\/stage\/([^/?]+)/);
    return {
      roomId: roomMatch?.[1],
      stageId: stageMatch?.[1],
    };
  }, [pathname]);

  if (!user || !activeProject || readOnly) return null;

  const prefix = tabsPrefix(role);
  const isContractor = role === 'contractor';
  const actions: Action[] = [
    {
      id: 'expense',
      label: 'Расход',
      sub: 'Скан чека или вручную',
      icon: 'receipt-outline',
      run: () => { setOpen(false); setExpenseOpen(true); },
    },
    ...(isContractor ? [{
      id: 'work',
      label: 'Работа',
      sub: 'Заказ в календаре',
      icon: 'hammer-outline' as keyof typeof Ionicons.glyphMap,
      run: () => { setOpen(false); setShowWork(true); },
    }, {
      id: 'scratch',
      label: 'В черновик',
      sub: 'Записать мысль',
      icon: 'document-text-outline',
      run: () => {
        setOpen(false);
        router.push({ pathname: '/scratchpad', params: { role, returnTo: pathname } } as any);
      },
    }] : [
      {
        id: 'remark',
        label: 'Замечание',
        sub: expenseContext.stageId ? 'К текущему этапу' : 'Раздел приёмки',
        icon: 'alert-circle-outline',
        run: () => {
          setOpen(false);
          if (expenseContext.stageId) {
            pushOsNav({ pathname: '/stage/[id]', params: { id: expenseContext.stageId, returnTo: pathname } }, pathname);
          } else {
            pushOsNav(repairTabRoute(role, 'control'), pathname);
          }
        },
      },
      {
        id: 'photo',
        label: 'Фото',
        sub: expenseContext.stageId ? 'На этап' : 'Скан или галерея',
        icon: 'camera-outline',
        run: () => {
          setOpen(false);
          if (expenseContext.stageId) {
            pushOsNav({ pathname: '/stage/[id]', params: { id: expenseContext.stageId, returnTo: pathname } }, pathname);
          } else {
            nav.scanReceipt(expenseContext.roomId, expenseContext.stageId);
          }
        },
      },
      {
        id: 'change',
        label: 'Запрос изменения',
        sub: 'Комната или план',
        icon: 'create-outline',
        run: () => {
          setOpen(false);
          pushOsNav(objectTabHref(role, 'rooms'), pathname);
        },
      },
    ]),
    {
      id: 'chat',
      label: 'Сообщение',
      sub: 'Новый чат или список',
      icon: 'chatbubble-outline',
      run: () => { setOpen(false); setChatOpen(true); },
    },
  ];

  const allowedIds = fabActionIdsForLevel(detailLevel, role);
  const visibleActions = allowedIds ? actions.filter((a) => allowedIds.has(a.id)) : actions;

  return (
    <>
      <Pressable style={s.fab} onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel="Быстрые действия">
        <Ionicons name="add" size={28} color={RenovaTheme.colors.inverseText} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={s.backdrop} onPress={() => setOpen(false)}>
          <View style={s.sheet}>
            <Text style={s.head}>Создать</Text>
            {visibleActions.map((a) => (
              <Pressable key={a.id} style={s.row} onPress={a.run}>
                <Ionicons name={a.icon} size={22} color={RenovaTheme.colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={s.label}>{a.label}</Text>
                  <Text style={s.sub}>{a.sub}</Text>
                </View>
              </Pressable>
            ))}
            <Pressable style={s.cancel} onPress={() => setOpen(false)}>
              <Text style={s.cancelT}>Отмена</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
      <Modal visible={expenseOpen} transparent animationType="fade" onRequestClose={() => setExpenseOpen(false)}>
        <Pressable style={s.backdrop} onPress={() => setExpenseOpen(false)}>
          <View style={s.sheet}>
            <Text style={s.head}>Добавить расход</Text>
            <Pressable style={s.row} onPress={() => { setExpenseOpen(false); nav.scanReceipt(expenseContext.roomId, expenseContext.stageId); }}>
              <Ionicons name="camera-outline" size={22} color={RenovaTheme.colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={s.label}>Скан чека</Text>
                <Text style={s.sub}>{expenseContext.roomId || expenseContext.stageId ? 'С привязкой к текущему контексту' : 'Камера или галерея'}</Text>
              </View>
            </Pressable>
            <Pressable style={s.row} onPress={() => {
              setExpenseOpen(false);
              pushOsNav(budgetTabHref(role, 'expenses', {
                roomId: expenseContext.roomId,
                stageId: expenseContext.stageId,
              }), pathname);
            }}>
              <Ionicons name="create-outline" size={22} color={RenovaTheme.colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={s.label}>Вручную</Text>
                <Text style={s.sub}>Бюджет → Расходы</Text>
              </View>
            </Pressable>
            <Pressable style={s.cancel} onPress={() => setExpenseOpen(false)}>
              <Text style={s.cancelT}>Отмена</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
      <Modal visible={chatOpen} transparent animationType="fade" onRequestClose={() => setChatOpen(false)}>
        <Pressable style={s.backdrop} onPress={() => setChatOpen(false)}>
          <View style={s.sheet}>
            <Text style={s.head}>Чат</Text>
            <TextInput
              style={s.chatInp}
              value={chatTitle}
              onChangeText={setChatTitle}
              placeholder="Тема чата"
            />
            <Pressable style={s.row} onPress={async () => {
              setChatOpen(false);
              try {
                const existing = await api.chatInbox(user.id).catch(() => []);
                await createProjectChat({
                  userId: user.id,
                  projectId: activeProject.id,
                  title: chatTitle.trim() || 'Чат',
                  existingThreads: existing,
                  onOpen: (id) => pushOsNav({ pathname: '/chat/[threadId]', params: { threadId: id } }, pathname),
                });
              } catch {
                pushOsNav(`${prefix}/chat`, pathname);
              }
            }}>
              <Ionicons name="add-circle-outline" size={22} color={RenovaTheme.colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={s.label}>Создать чат</Text>
                <Text style={s.sub}>Открыть новый диалог по проекту</Text>
              </View>
            </Pressable>
            <Pressable style={s.row} onPress={() => { setChatOpen(false); pushOsNav(`${prefix}/chat`, pathname); }}>
              <Ionicons name="chatbubbles-outline" size={22} color={RenovaTheme.colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={s.label}>Все чаты</Text>
                <Text style={s.sub}>Список и архив</Text>
              </View>
            </Pressable>
            <Pressable style={s.cancel} onPress={() => setChatOpen(false)}>
              <Text style={s.cancelT}>Отмена</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
      {showWork ? (
        <CreateWorkSheet
          visible={showWork}
          userId={user.id}
          projectId={activeProject.id}
          rooms={activeProject.rooms || []}
          variant={isContractor ? 'contractor' : 'customer'}
          onClose={() => setShowWork(false)}
          onCreated={async () => {
            await loadProject(activeProject.id);
            setShowWork(false);
          }}
        />
      ) : null}
    </>
  );
}

const s = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: 16,
    bottom: Platform.OS === 'web' ? 88 : 76,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: RenovaTheme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    zIndex: 20,
  },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: RenovaTheme.colors.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, paddingBottom: 28 },
  head: { fontSize: 16, fontWeight: '800', marginBottom: 12, color: RenovaTheme.colors.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#f0f0f0' },
  label: { fontSize: 15, fontWeight: '700', color: RenovaTheme.colors.text },
  sub: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginTop: 2 },
  cancel: { marginTop: 12, alignItems: 'center', paddingVertical: 10 },
  cancelT: { fontSize: 15, fontWeight: '600', color: RenovaTheme.colors.textMuted },
  chatInp: { borderWidth: 1, borderColor: RenovaTheme.colors.borderLight, borderRadius: 10, padding: 12, marginBottom: 8, fontSize: 15 },
});
