/** Создание чата — модал: название, объект, тема, участники */
import { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  ScrollView,
  Alert,
} from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { FilterDropdown } from '@/components/renova/FilterDropdown';
import { createProjectChat, type ChatParticipantInvite } from '@/lib/createProjectChat';
import type { ChatThread } from '@/lib/api';

const CHAT_TOPICS = [
  { value: 'general', label: 'Общий' },
  { value: 'materials', label: 'Материалы' },
  { value: 'work', label: 'Работы' },
  { value: 'payment', label: 'Оплата' },
] as const;

type Topic = (typeof CHAT_TOPICS)[number]['value'];

type ProjectOption = { id: string; name: string };

type Props = {
  visible: boolean;
  onClose: () => void;
  userId: string;
  projects: ProjectOption[];
  defaultProjectId: string | null;
  projectLocked: boolean;
  selectableProjectIds: string[];
  existingThreads: ChatThread[];
  onCreated: () => void;
  onOpenChat: (threadId: string, projectId: string) => void;
};

type InviteRow = { id: string; phone: string; profileCode: string };

function emptyInvite(): InviteRow {
  return { id: `${Date.now()}-${Math.random()}`, phone: '', profileCode: '' };
}

export function CreateChatSheet({
  visible,
  onClose,
  userId,
  projects,
  defaultProjectId,
  projectLocked,
  selectableProjectIds,
  existingThreads,
  onCreated,
  onOpenChat,
}: Props) {
  const [title, setTitle] = useState('');
  const [topic, setTopic] = useState<Topic>('general');
  const [projectId, setProjectId] = useState(defaultProjectId ?? '');
  const [invites, setInvites] = useState<InviteRow[]>([emptyInvite()]);
  const [busy, setBusy] = useState(false);

  const projectOptions = useMemo(
    () =>
      projects
        .filter((p) => selectableProjectIds.includes(p.id))
        .map((p) => ({ value: p.id, label: p.name })),
    [projects, selectableProjectIds],
  );

  const projectName = projects.find((p) => p.id === projectId)?.name ?? '';

  useEffect(() => {
    if (!visible) return;
    setTitle('');
    setTopic('general');
    setProjectId(defaultProjectId ?? projectOptions[0]?.value ?? '');
    setInvites([emptyInvite()]);
    setBusy(false);
  }, [visible, defaultProjectId, projectOptions]);

  const updateInvite = (id: string, patch: Partial<InviteRow>) => {
    setInvites((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const submit = async () => {
    if (!projectId) {
      Alert.alert('Выберите объект', 'Каждый чат привязан к одному объекту.');
      return;
    }
    const trimmed = title.trim();
    if (!trimmed) {
      Alert.alert('Название чата', 'Укажите тему переписки — например «Согласование плитки».');
      return;
    }

    const participantInvites: ChatParticipantInvite[] = invites
      .map((r) => ({
        phone: r.phone.trim() || undefined,
        profile_code: r.profileCode.trim().toUpperCase() || undefined,
      }))
      .filter((r) => r.phone || r.profile_code);

    setBusy(true);
    try {
      await createProjectChat({
        userId,
        projectId,
        title: trimmed,
        topic,
        existingThreads,
        invites: participantInvites,
        onOpen: (id) => {
          onCreated();
          onOpenChat(id, projectId);
          onClose();
        },
      });
    } catch (e: any) {
      Alert.alert('Не удалось создать чат', e?.message ?? 'Попробуйте ещё раз');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.sheet} onPress={(e) => e.stopPropagation()}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.scroll}>
            <Text style={s.head}>Новый чат</Text>
            <Text style={s.sub}>Один чат — один объект. Участников можно добавить сразу или позже в настройках чата.</Text>

            <Text style={s.label}>Название</Text>
            <TextInput
              style={s.input}
              value={title}
              onChangeText={setTitle}
              placeholder="Например: Согласование материалов"
              autoFocus
            />

            <Text style={s.label}>Тема</Text>
            <View style={s.chips}>
              {CHAT_TOPICS.map((t) => {
                const on = topic === t.value;
                return (
                  <Pressable
                    key={t.value}
                    style={[s.chip, on && s.chipOn]}
                    onPress={() => setTopic(t.value)}
                  >
                    <Text style={[s.chipT, on && s.chipTOn]}>{t.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={s.label}>Объект</Text>
            {projectLocked ? (
              <View style={s.lockedBox}>
                <Text style={s.lockedText}>{projectName || '—'}</Text>
                <Text style={s.lockedHint}>Как в фильтре списка чатов</Text>
              </View>
            ) : (
              <FilterDropdown
                title="Объект чата"
                hint="Чат будет привязан только к выбранному объекту"
                value={projectId}
                options={projectOptions}
                onChange={setProjectId}
              />
            )}

            <Text style={s.label}>Участники (необязательно)</Text>
            <Text style={s.hint}>Телефон или номер профиля Renova — приглашение уйдёт после создания чата.</Text>
            {invites.map((row, idx) => (
              <View key={row.id} style={s.inviteRow}>
                <TextInput
                  style={[s.input, s.inviteInput]}
                  value={row.profileCode}
                  onChangeText={(v) => updateInvite(row.id, { profileCode: v })}
                  placeholder="Профиль (6 символов)"
                  autoCapitalize="characters"
                />
                <Text style={s.or}>или</Text>
                <TextInput
                  style={[s.input, s.inviteInput]}
                  value={row.phone}
                  onChangeText={(v) => updateInvite(row.id, { phone: v })}
                  placeholder="Телефон +7…"
                  keyboardType="phone-pad"
                />
                {invites.length > 1 ? (
                  <Pressable onPress={() => setInvites((rows) => rows.filter((r) => r.id !== row.id))}>
                    <Text style={s.remove}>Удалить</Text>
                  </Pressable>
                ) : null}
                {idx === invites.length - 1 && invites.length < 5 ? (
                  <Pressable onPress={() => setInvites((rows) => [...rows, emptyInvite()])}>
                    <Text style={s.addLink}>+ Ещё участник</Text>
                  </Pressable>
                ) : null}
              </View>
            ))}

            <PrimaryButton title={busy ? 'Создаём…' : 'Создать и открыть'} onPress={submit} disabled={busy} fullWidth />
            <PrimaryButton title="Отмена" variant="outline" onPress={onClose} fullWidth />
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '92%',
    backgroundColor: RenovaTheme.colors.surface,
    borderTopLeftRadius: RenovaTheme.radius.xl,
    borderTopRightRadius: RenovaTheme.radius.xl,
  },
  scroll: { padding: RenovaTheme.spacing.lg, paddingBottom: 32, gap: 4 },
  head: { fontSize: 20, fontWeight: '800', color: RenovaTheme.colors.text, marginBottom: 4 },
  sub: { fontSize: 13, color: RenovaTheme.colors.textMuted, lineHeight: 18, marginBottom: 12 },
  label: { fontSize: 12, fontWeight: '700', color: RenovaTheme.colors.textMuted, marginTop: 10, marginBottom: 6, textTransform: 'uppercase' },
  hint: { fontSize: 12, color: RenovaTheme.colors.textMuted, lineHeight: 17, marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    borderRadius: RenovaTheme.radius.sm,
    padding: 12,
    fontSize: 15,
    color: RenovaTheme.colors.text,
    backgroundColor: RenovaTheme.colors.background,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: RenovaTheme.radius.pill,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    backgroundColor: RenovaTheme.colors.surface,
  },
  chipOn: { borderColor: RenovaTheme.colors.primary, backgroundColor: RenovaTheme.colors.infoBg },
  chipT: { fontSize: 13, fontWeight: '600', color: RenovaTheme.colors.textMuted },
  chipTOn: { color: RenovaTheme.colors.primary },
  lockedBox: {
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    borderRadius: RenovaTheme.radius.sm,
    padding: 12,
    backgroundColor: RenovaTheme.colors.borderLight,
  },
  lockedText: { fontSize: 15, fontWeight: '700', color: RenovaTheme.colors.text },
  lockedHint: { fontSize: 11, color: RenovaTheme.colors.textMuted, marginTop: 4 },
  inviteRow: { gap: 6, marginBottom: 10 },
  inviteInput: { marginBottom: 0 },
  or: { fontSize: 11, color: RenovaTheme.colors.textMuted, textAlign: 'center' },
  addLink: { fontSize: 13, fontWeight: '700', color: RenovaTheme.colors.primary, marginTop: 4 },
  remove: { fontSize: 12, color: RenovaTheme.colors.danger, fontWeight: '600' },
});
