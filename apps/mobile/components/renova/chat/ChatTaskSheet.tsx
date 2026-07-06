/** Форма задачи из чата — название, ответственный, срок */
import { useEffect, useState } from 'react';
import { Modal, View, Text, TextInput, StyleSheet, Pressable, ScrollView } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { api } from '@/lib/api';

const DUE_PRESETS = [
  { label: 'Завтра', days: 1 },
  { label: '3 дня', days: 3 },
  { label: 'Неделя', days: 7 },
  { label: '2 недели', days: 14 },
];

export function ChatTaskSheet({
  visible,
  defaultTitle,
  userId,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  defaultTitle: string;
  userId: string;
  onClose: () => void;
  onSubmit: (body: { title: string; assignee_id?: string; due_at?: string }) => Promise<void>;
}) {
  const [title, setTitle] = useState(defaultTitle);
  const [dueDays, setDueDays] = useState(3);
  const [assigneeId, setAssigneeId] = useState<string | undefined>();
  const [members, setMembers] = useState<{ user_id: string; phone: string; role: string }[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (visible) setTitle(defaultTitle); }, [visible, defaultTitle]);
  useEffect(() => {
    if (!visible) return;
    api.getTeam(userId).then((t) => setMembers(t?.members || [])).catch(() => setMembers([]));
  }, [visible, userId]);

  async function save() {
    if (!title.trim()) return;
    setBusy(true);
    try {
      const due_at = new Date(Date.now() + dueDays * 86400000).toISOString();
      await onSubmit({ title: title.trim(), assignee_id: assigneeId, due_at });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.sheet} onPress={(e) => e.stopPropagation()}>
          <Text style={s.head}>Задача из сообщения</Text>
          <TextInput style={s.inp} value={title} onChangeText={setTitle} placeholder="Название задачи" />
          <Text style={s.label}>Срок</Text>
          <View style={s.row}>
            {DUE_PRESETS.map((p) => (
              <PrimaryButton
                key={p.days}
                title={p.label}
                compact
                variant={dueDays === p.days ? 'primary' : 'outline'}
                onPress={() => setDueDays(p.days)}
              />
            ))}
          </View>
          {members.length > 0 && (
            <>
              <Text style={s.label}>Ответственный</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.members}>
                <Pressable style={[s.chip, !assigneeId && s.chipOn]} onPress={() => setAssigneeId(undefined)}>
                  <Text style={s.chipT}>Не назначен</Text>
                </Pressable>
                {members.map((m) => (
                  <Pressable key={m.user_id} style={[s.chip, assigneeId === m.user_id && s.chipOn]} onPress={() => setAssigneeId(m.user_id)}>
                    <Text style={s.chipT}>{m.phone.slice(-4)} · {m.role}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </>
          )}
          <PrimaryButton title={busy ? 'Создание…' : 'Создать задачу'} onPress={save} disabled={busy} />
          <PrimaryButton title="Отмена" variant="outline" onPress={onClose} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: RenovaTheme.colors.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, paddingBottom: 28 },
  head: { fontSize: 17, fontWeight: '800', marginBottom: 12 },
  inp: { borderWidth: 1, borderColor: RenovaTheme.colors.borderLight, borderRadius: 10, padding: 12, marginBottom: 12, fontSize: 15 },
  label: { fontSize: 12, fontWeight: '700', color: RenovaTheme.colors.textMuted, textTransform: 'uppercase', marginBottom: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  members: { gap: 6, marginBottom: 12 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, backgroundColor: RenovaTheme.colors.border, marginRight: 6 },
  chipOn: { backgroundColor: RenovaTheme.colors.primary },
  chipT: { fontSize: 12, fontWeight: '600' },
});
