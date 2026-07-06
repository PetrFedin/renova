/** Черновик — записная книжка проекта с превращением в задачи и расходы */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, ScrollView, Pressable, Alert, KeyboardAvoidingView, Platform, Modal,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { RenovaTheme } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { CreateWorkSheet } from '@/components/renova/CreateWorkSheet';
import { ScratchpadLineRow } from '@/components/renova/scratchpad/ScratchpadLineRow';
import { ReadOnlyBanner } from '@/components/renova/ReadOnlyGuard';
import { ProjectEmptyState } from '@/components/renova/ProjectEmptyState';
import { useRenova } from '@/lib/context/RenovaContext';
import { api, type ScratchpadLine } from '@/lib/api';
import { createProjectChat } from '@/lib/createProjectChat';
import { budgetTabHref, calendarTabHref, type OsRole } from '@/constants/osSections';
import { pushOsNav } from '@/lib/pushOsNav';

const HINT = 'Пишите что угодно. [ ] пункт · [x] сделано · 🛒 покупка. Нажмите строку — редактирование, → — превратить в задачу, чат или расход.';

export function ScratchpadScreen({ role }: { role: OsRole }) {
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const { user, activeProject, readOnly } = useRenova();
  const [lines, setLines] = useState<ScratchpadLine[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [promoteLine, setPromoteLine] = useState<ScratchpadLine | null>(null);
  const [workOpen, setWorkOpen] = useState(false);
  const [editLine, setEditLine] = useState<ScratchpadLine | null>(null);
  const [editText, setEditText] = useState('');

  const reload = useCallback(() => {
    if (!user || !activeProject) return;
    api.listScratchpad(user.id, activeProject.id).then((d) => setLines(d.lines || [])).catch(() => setLines([]));
  }, [user?.id, activeProject?.id]);

  useEffect(() => { reload(); }, [reload]);

  const active = useMemo(() => lines.filter((l) => !l.done && !l.promoted_kind), [lines]);
  const done = useMemo(() => lines.filter((l) => l.done || l.promoted_kind), [lines]);

  const addLine = async () => {
    if (!user || !activeProject || !draft.trim() || readOnly) return;
    const text = draft.trim();
    setBusy(true);
    try {
      const line = await api.createScratchpadLine(user.id, activeProject.id, text);
      setDraft('');
      // Сразу показываем строку — не ждём повторный GET (раньше cachedGet отдавал старый список).
      setLines((prev) => [...prev, line]);
      reload();
    } catch {
      Alert.alert('Черновик', 'Не удалось сохранить строку');
    } finally {
      setBusy(false);
    }
  };

  const toggleLine = async (line: ScratchpadLine) => {
    if (!user || !activeProject || readOnly) return;
    try {
      await api.patchScratchpadLine(user.id, activeProject.id, line.id, { done: !line.done });
      reload();
    } catch { /* offline */ }
  };

  const deleteLine = (line: ScratchpadLine) => {
    if (!user || !activeProject || readOnly) return;
    Alert.alert('Удалить строку?', line.text, [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: async () => {
          await api.deleteScratchpadLine(user.id, activeProject.id, line.id);
          reload();
        },
      },
    ]);
  };

  const markPromoted = async (line: ScratchpadLine, kind: string, id?: string) => {
    if (!user || !activeProject) return;
    await api.patchScratchpadLine(user.id, activeProject.id, line.id, {
      promoted_kind: kind,
      promoted_id: id || null,
      done: true,
    });
    reload();
  };

  const openEdit = (line: ScratchpadLine) => {
    if (readOnly) return;
    setEditLine(line);
    setEditText(line.text);
  };

  const saveEdit = async () => {
    if (!user || !activeProject || !editLine || !editText.trim()) return;
    setBusy(true);
    try {
      await api.patchScratchpadLine(user.id, activeProject.id, editLine.id, { text: editText.trim() });
      setEditLine(null);
      reload();
    } catch {
      Alert.alert('Черновик', 'Не удалось сохранить изменения');
    } finally {
      setBusy(false);
    }
  };

  const openPromoteMenu = (line: ScratchpadLine) => {
    if (readOnly) return;
    Alert.alert(line.text, 'Превратить заметку в', [
      {
        text: '→ Задача в календаре',
        onPress: () => { setPromoteLine(line); setWorkOpen(true); },
      },
      {
        text: '→ Сообщение в чат',
        onPress: async () => {
          if (!user || !activeProject) return;
          try {
            const existing = await api.chatInbox(user.id).catch(() => []);
            const title = line.text.slice(0, 60);
            await createProjectChat({
              userId: user.id,
              projectId: activeProject.id,
              title,
              existingThreads: existing,
              onOpen: async (threadId) => {
                await markPromoted(line, 'chat', threadId);
                pushOsNav({ pathname: '/chat/[threadId]', params: { threadId } }, returnTo);
              },
            });
          } catch {
            Alert.alert('Чат', 'Не удалось создать чат');
          }
        },
      },
      {
        text: '→ Расход',
        onPress: async () => {
          await markPromoted(line, 'expense');
          pushOsNav(budgetTabHref(role, 'expenses'), returnTo);
        },
      },
      { text: 'Отмена', style: 'cancel' },
      { text: 'Удалить', style: 'destructive', onPress: () => deleteLine(line) },
    ]);
  };

  if (!user) return null;
  if (!activeProject) {
    return (
      <View style={s.root}>
        <View style={s.head}>
          <Pressable onPress={() => (returnTo ? router.replace(returnTo as any) : router.back())} style={s.back}>
            <Ionicons name="chevron-back" size={22} color={RenovaTheme.colors.accent} />
            <Text style={s.backT}>Назад</Text>
          </Pressable>
          <Text style={s.title}>Черновик</Text>
        </View>
        <ProjectEmptyState role={role} hint="Выберите объект — черновик привязан к проекту." />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ReadOnlyBanner />
      <View style={s.head}>
        <Pressable onPress={() => (returnTo ? router.replace(returnTo as any) : router.back())} style={s.back}>
          <Ionicons name="chevron-back" size={22} color={RenovaTheme.colors.accent} />
          <Text style={s.backT}>Назад</Text>
        </Pressable>
        <Text style={s.title}>Черновик</Text>
        <Text style={s.sub}>{activeProject.name}</Text>
        <Text style={s.hint}>{HINT}</Text>
      </View>

      <ScrollView style={s.list} contentContainerStyle={{ paddingBottom: 120 }}>
        {active.length ? (
          <>
            <Text style={s.section}>Активные ({active.length})</Text>
            {active.map((line) => (
              <ScratchpadLineRow
                key={line.id}
                line={line}
                readOnly={readOnly}
                onToggle={() => toggleLine(line)}
                onEdit={() => openEdit(line)}
                onPromote={() => openPromoteMenu(line)}
                onDelete={() => deleteLine(line)}
              />
            ))}
          </>
        ) : (
          <Text style={s.empty}>Пока пусто — запишите мысли ниже, пока не забыли.</Text>
        )}
        {done.length ? (
          <>
            <Text style={[s.section, { marginTop: 16 }]}>Сделано / оформлено ({done.length})</Text>
            {done.map((line) => (
              <ScratchpadLineRow
                key={line.id}
                line={line}
                readOnly={readOnly}
                onToggle={() => toggleLine(line)}
                onEdit={() => openEdit(line)}
                onPromote={() => openPromoteMenu(line)}
                onDelete={() => deleteLine(line)}
              />
            ))}
          </>
        ) : null}
      </ScrollView>

      {!readOnly ? (
        <View style={s.composer}>
          <TextInput
            style={s.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="[ ] снять сантехнику · 🛒 клей для плитки…"
            multiline
            maxLength={4000}
          />
          <PrimaryButton title="Записать" compact disabled={busy || !draft.trim()} onPress={addLine} />
        </View>
      ) : null}

      <CreateWorkSheet
        visible={workOpen}
        userId={user.id}
        projectId={activeProject.id}
        rooms={activeProject.rooms || []}
        variant={role === 'customer' ? 'customer' : 'contractor'}
        defaultTitle={promoteLine?.text}
        onClose={() => { setWorkOpen(false); setPromoteLine(null); }}
        onCreated={() => { setWorkOpen(false); setPromoteLine(null); reload(); }}
        onCreatedWork={async (wo) => {
          if (!promoteLine) return;
          await markPromoted(promoteLine, 'work_order', wo.id);
          const date = (wo.planned_start || new Date().toISOString()).slice(0, 10);
          pushOsNav(calendarTabHref(role, { date }), returnTo);
        }}
      />

      <Modal visible={!!editLine} transparent animationType="fade" onRequestClose={() => setEditLine(null)}>
        <Pressable style={s.modalBackdrop} onPress={() => setEditLine(null)}>
          <Pressable style={s.modalSheet} onPress={(e) => e.stopPropagation()}>
            <Text style={s.modalTitle}>Редактировать</Text>
            <TextInput
              style={s.input}
              value={editText}
              onChangeText={setEditText}
              multiline
              autoFocus
              maxLength={4000}
            />
            <PrimaryButton title="Сохранить" compact disabled={busy || !editText.trim()} onPress={saveEdit} />
            <PrimaryButton title="Отмена" variant="outline" compact onPress={() => setEditLine(null)} />
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: RenovaTheme.colors.background },
  head: { padding: 16, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: RenovaTheme.colors.border },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, marginBottom: 6 },
  backT: { color: RenovaTheme.colors.accent, fontWeight: '600', fontSize: 13 },
  title: { fontSize: 22, fontWeight: '800', color: RenovaTheme.colors.text },
  sub: { fontSize: 13, color: RenovaTheme.colors.textMuted, marginTop: 2 },
  hint: { fontSize: 12, color: RenovaTheme.colors.textMuted, lineHeight: 17, marginTop: 8 },
  list: { flex: 1, paddingHorizontal: 16, paddingTop: 12 },
  section: { fontSize: 12, fontWeight: '700', color: RenovaTheme.colors.textMuted, marginBottom: 8, textTransform: 'uppercase' },
  empty: { fontSize: 14, color: RenovaTheme.colors.textMuted, lineHeight: 20, paddingVertical: 24, textAlign: 'center' },
  composer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 12,
    paddingBottom: Platform.OS === 'web' ? 16 : 24,
    backgroundColor: RenovaTheme.colors.surface,
    borderTopWidth: 1,
    borderTopColor: RenovaTheme.colors.border,
    gap: 8,
  },
  input: {
    minHeight: 44,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    borderRadius: 10,
    padding: 10,
    fontSize: 15,
    backgroundColor: RenovaTheme.colors.surface,
  },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', padding: 20 },
  modalSheet: { backgroundColor: RenovaTheme.colors.surface, borderRadius: 14, padding: 16, gap: 10 },
  modalTitle: { fontSize: 17, fontWeight: '800', color: RenovaTheme.colors.text },
});
