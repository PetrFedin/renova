/** Единая точка «+» — расход (scan/manual) · работа · чат */
import { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Platform, TextInput, Alert } from 'react-native';
import { usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { RenovaTheme } from '@/constants/Theme';
import { inputField } from '@/constants/uiTokens';
import { reportError } from '@/lib/reportError';
import { useRenova } from '@/lib/context/RenovaContext';
import { api } from '@/lib/api';
import { useNavFromHere } from '@/lib/navigation';
import { createProjectChat } from '@/lib/createProjectChat';
import { CreateWorkSheet } from '@/components/renova/CreateWorkSheet';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { SheetSurface } from '@/components/renova/SheetSurface';
import { tabsPrefix, budgetTabHref, type OsRole } from '@/constants/osSections';
import { pushOsNav } from '@/lib/pushOsNav';
import { useDetailLevel } from '@/lib/useDetailLevel';
import { fabActionIdsForLevel } from '@/lib/detailLevelPolicy';

type Action = {
  id: string;
  label: string;
  sub: string;
  icon: keyof typeof Ionicons.glyphMap;
  run: () => void;
};

type QuickActionRowProps = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  sub: string;
  onPress: () => void | Promise<void>;
};

function QuickActionRow({ icon, label, sub, onPress }: QuickActionRowProps) {
  return (
    <Pressable
      style={({ pressed }) => [s.row, pressed && s.rowPressed]}
      onPress={() => { void onPress(); }}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={sub}
    >
      <Ionicons name={icon} size={22} color={RenovaTheme.colors.primary} />
      <View style={s.rowBody}>
        <Text style={s.label}>{label}</Text>
        <Text style={s.sub}>{sub}</Text>
      </View>
    </Pressable>
  );
}

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
  const contractorActions: Action[] = isContractor
    ? [
        {
          id: 'work',
          label: 'Работа',
          sub: 'Заказ в календаре',
          icon: 'hammer-outline',
          run: () => { setOpen(false); setShowWork(true); },
        },
        {
          id: 'scratch',
          label: 'В черновик',
          sub: 'Записать мысль',
          icon: 'document-text-outline',
          run: () => {
            setOpen(false);
            pushOsNav({ pathname: '/scratchpad', params: { role } }, pathname, role);
          },
        },
      ]
    : [];

  const actions: Action[] = [
    {
      id: 'expense',
      label: 'Расход',
      sub: 'Скан чека или вручную',
      icon: 'receipt-outline',
      run: () => { setOpen(false); setExpenseOpen(true); },
    },
    ...contractorActions,
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
      <Pressable
        style={({ pressed }) => [s.fab, pressed && s.fabPressed]}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Быстрые действия"
      >
        <Ionicons name="add" size={28} color={RenovaTheme.colors.inverseText} />
      </Pressable>

      <SheetSurface
        visible={open}
        onClose={() => setOpen(false)}
        title="Создать"
        accessibilityLabel="Быстрые действия"
        footer={<PrimaryButton title="Отмена" variant="ghost" onPress={() => setOpen(false)} />}
      >
        {visibleActions.map((a) => (
          <QuickActionRow key={a.id} icon={a.icon} label={a.label} sub={a.sub} onPress={a.run} />
        ))}
      </SheetSurface>

      <SheetSurface
        visible={expenseOpen}
        onClose={() => setExpenseOpen(false)}
        title="Добавить расход"
        footer={<PrimaryButton title="Отмена" variant="ghost" onPress={() => setExpenseOpen(false)} />}
      >
        <QuickActionRow
          icon="camera-outline"
          label="Скан чека"
          sub={expenseContext.roomId || expenseContext.stageId ? 'С привязкой к текущему контексту' : 'Камера или галерея'}
          onPress={() => {
            setExpenseOpen(false);
            nav.scanReceipt(expenseContext.roomId, expenseContext.stageId);
          }}
        />
        <QuickActionRow
          icon="create-outline"
          label="Вручную"
          sub="Бюджет → Расходы"
          onPress={() => {
            setExpenseOpen(false);
            pushOsNav(budgetTabHref(role, 'expenses', {
              roomId: expenseContext.roomId,
              stageId: expenseContext.stageId,
            }), pathname, role);
          }}
        />
      </SheetSurface>

      <SheetSurface
        visible={chatOpen}
        onClose={() => setChatOpen(false)}
        title="Чат"
        footer={<PrimaryButton title="Отмена" variant="ghost" onPress={() => setChatOpen(false)} />}
      >
        <TextInput
          style={s.chatInp}
          value={chatTitle}
          onChangeText={setChatTitle}
          placeholder="Тема чата"
          accessibilityLabel="Тема чата"
        />
        <QuickActionRow
          icon="add-circle-outline"
          label="Создать чат"
          sub="Открыть новый диалог по проекту"
          onPress={async () => {
            setChatOpen(false);
            try {
              let existing: Awaited<ReturnType<typeof api.chatInbox>>;
              try {
                existing = await api.chatInbox(user.id);
              } catch (error) {
                reportError('quickFab.chatInbox', error, { projectId: activeProject.id });
                Alert.alert('Чат', 'Не удалось загрузить чаты. Проверьте сеть.');
                return;
              }
              await createProjectChat({
                user,
                projectId: activeProject.id,
                title: chatTitle.trim() || 'Чат',
                existingThreads: existing,
                onOpen: (id) => pushOsNav({ pathname: '/chat/[threadId]', params: { threadId: id } }, pathname, role),
              });
            } catch (error) {
              reportError('quickFab.createChat', error, { projectId: activeProject.id });
              Alert.alert('Чат', 'Не удалось создать чат. Проверьте подключение и повторите.');
            }
          }}
        />
        <QuickActionRow
          icon="chatbubbles-outline"
          label="Все чаты"
          sub="Список и архив"
          onPress={() => {
            setChatOpen(false);
            pushOsNav(`${prefix}/chat`, pathname, role);
          }}
        />
      </SheetSurface>

      {showWork ? (
        <CreateWorkSheet
          visible={showWork}
          userId={user.id}
          projectId={activeProject.id}
          rooms={activeProject.rooms || []}
          variant={isContractor ? 'contractor' : 'customer'}
          onClose={() => setShowWork(false)}
          onCreated={async () => {
            const projectId = activeProject.id;
            setShowWork(false);
            try {
              await loadProject(projectId);
            } catch (error) {
              reportError('quickFab.work.refresh', error, { projectId });
            }
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
    shadowColor: RenovaTheme.shadow.card.shadowColor,
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    zIndex: 20,
  },
  fabPressed: { opacity: 0.82 },
  row: {
    minHeight: RenovaTheme.minTouch,
    flexDirection: 'row',
    alignItems: 'center',
    gap: RenovaTheme.spacing.md,
    paddingVertical: RenovaTheme.spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: RenovaTheme.colors.borderLight,
  },
  rowPressed: { opacity: 0.72 },
  rowBody: { flex: 1, minWidth: 0 },
  label: { fontSize: 15, fontWeight: '700', color: RenovaTheme.colors.text },
  sub: { fontSize: RenovaTheme.fontSize.caption, color: RenovaTheme.colors.textMuted, marginTop: 2 },
  chatInp: { ...inputField, marginBottom: RenovaTheme.spacing.sm },
});
