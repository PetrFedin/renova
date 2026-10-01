/** Форма задачи из чата — название, ответственный, срок */
import { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, ScrollView } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { screenTypography } from '@/constants/screenTypography';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { SheetSurface } from '@/components/renova/SheetSurface';
import { notifyError } from '@/lib/notify';
import { api } from '@/lib/api';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { reportError } from '@/lib/reportError';

const DUE_PRESETS = [
  { label: 'Завтра', days: 1 },
  { label: '3 дня', days: 3 },
  { label: 'Неделя', days: 7 },
  { label: '2 недели', days: 14 },
];

const ROLE_LABEL: Record<string, string> = {
  owner: 'владелец',
  foreman: 'прораб',
  worker: 'рабочий',
  field: 'рабочий',
  viewer: 'наблюдатель',
};

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
  const reloadMembers = useCallback(() => {
    if (!visible) return;
    api.getTeam(userId).then((t) => setMembers(t?.members || [])).catch((e) => { reportError('components.renova.chat.ChatTaskSheet.Members', e); setMembers([]); });
  }, [visible, userId]);
  useEffect(() => { reloadMembers(); }, [reloadMembers]);
  useProjectDataReload(reloadMembers);

  async function save() {
    if (!title.trim()) return;
    setBusy(true);
    try {
      const due_at = new Date(Date.now() + dueDays * 86400000).toISOString();
      await onSubmit({ title: title.trim(), assignee_id: assigneeId, due_at });
      onClose();
    } catch (e) {
      reportError('components.renova.chat.ChatTaskSheet.Submit', e);
      notifyError('Не удалось создать задачу', e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SheetSurface
      visible={visible}
      onClose={onClose}
      busy={busy}
      title="Задача из сообщения"
      footer={
        <>
          <PrimaryButton title={busy ? 'Создание…' : 'Создать задачу'} variant="accent" onPress={save} loading={busy} disabled={busy || !title.trim()} />
          <PrimaryButton title="Отмена" variant="outline" onPress={onClose} disabled={busy} />
        </>
      }
    >
      <TextInput style={s.inp} value={title} onChangeText={setTitle} placeholder="Название задачи" accessibilityLabel="Название задачи" />
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
          <ScrollView horizontal style={{ flexGrow: 0 }} showsHorizontalScrollIndicator={false} contentContainerStyle={s.members}>
            <Pressable style={[s.chip, !assigneeId && s.chipOn]} onPress={() => setAssigneeId(undefined)} accessibilityRole="button" accessibilityState={{ selected: !assigneeId }} accessibilityLabel="Не назначен">
              <Text style={[s.chipT, !assigneeId && s.chipTOn]}>Не назначен</Text>
            </Pressable>
            {members.map((m) => (
              <Pressable key={m.user_id} style={[s.chip, assigneeId === m.user_id && s.chipOn]} onPress={() => setAssigneeId(m.user_id)} accessibilityRole="button" accessibilityState={{ selected: assigneeId === m.user_id }} accessibilityLabel={`Ответственный: ${m.phone}`}>
                <Text style={[s.chipT, assigneeId === m.user_id && s.chipTOn]}>{m.phone.slice(-4)} · {ROLE_LABEL[m.role] ?? 'участник'}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </>
      )}
    </SheetSurface>
  );
}

const s = StyleSheet.create({
  inp: { borderWidth: 1, borderColor: RenovaTheme.colors.borderLight, borderRadius: 10, padding: 12, marginBottom: 12, fontSize: 15 },
  label: { ...screenTypography.section, marginTop: 0, marginBottom: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  members: { gap: 6, marginBottom: 12 },
  chip: { minHeight: RenovaTheme.minTouch, justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, backgroundColor: RenovaTheme.colors.border, marginRight: 6 },
  chipOn: { backgroundColor: RenovaTheme.colors.primary },
  chipT: { fontSize: 12, fontWeight: '600', color: RenovaTheme.colors.text },
  chipTOn: { color: RenovaTheme.colors.inverseText },
});
