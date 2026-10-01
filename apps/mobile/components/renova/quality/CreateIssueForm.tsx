/** QLT-007: замечание вне плана этажа — описание, серьёзность, комната и этап. */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { RenovaTheme } from '@/constants/Theme';
import { screenTypography } from '@/constants/screenTypography';
import { buildNewIssueBody, validateNewIssue, type NewIssueBody } from '@/lib/domain/newIssueForm';

type Option = { id: string; name: string };
const SEVERITIES: { key: NewIssueBody['severity']; label: string }[] = [
  { key: 'low', label: 'Низкий' },
  { key: 'medium', label: 'Средний' },
  { key: 'high', label: 'Высокий' },
  { key: 'critical', label: 'Критично' },
];

function Chips({ options, value, onChange, empty }: { options: Option[]; value: string | null; onChange: (id: string | null) => void; empty: string }) {
  return (
    <View style={s.chips}>
      <Pressable accessibilityRole="button" style={[s.chip, value === null && s.chipOn]} onPress={() => onChange(null)}>
        <Text style={[s.chipT, value === null && s.chipTOn]}>{empty}</Text>
      </Pressable>
      {options.map((o) => (
        <Pressable key={o.id} accessibilityRole="button" style={[s.chip, value === o.id && s.chipOn]} onPress={() => onChange(o.id)}>
          <Text style={[s.chipT, value === o.id && s.chipTOn]}>{o.name}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function CreateIssueForm({
  rooms,
  stages,
  busy,
  onSubmit,
  onCancel,
}: {
  rooms: Option[];
  stages: Option[];
  busy: boolean;
  onSubmit: (body: NewIssueBody) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<NewIssueBody['severity']>('medium');
  const [roomId, setRoomId] = useState<string | null>(null);
  const [stageId, setStageId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const problem = validateNewIssue(title);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    const ok = await onSubmit(buildNewIssueBody({ title, description, severity, roomId, stageId }));
    if (ok) {
      setTitle('');
      setDescription('');
      setRoomId(null);
      setStageId(null);
    }
  };

  return (
    <View style={s.box}>
      <Text style={s.label}>Что не так</Text>
      <TextInput
        style={s.input}
        value={title}
        onChangeText={setTitle}
        placeholder="Например: трещина на стене у окна"
        placeholderTextColor={RenovaTheme.colors.textMuted}
        maxLength={200}
        editable={!busy}
        accessibilityLabel="Название замечания"
      />
      <TextInput
        style={[s.input, s.multiline]}
        value={description}
        onChangeText={setDescription}
        placeholder="Подробности (необязательно)"
        placeholderTextColor={RenovaTheme.colors.textMuted}
        multiline
        maxLength={2000}
        editable={!busy}
        accessibilityLabel="Описание замечания"
      />
      <Text style={s.label}>Серьёзность</Text>
      <Chips options={SEVERITIES.map((v) => ({ id: v.key, name: v.label }))} value={severity} onChange={(id) => setSeverity((id as NewIssueBody['severity']) ?? 'medium')} empty="—" />
      {rooms.length ? (
        <>
          <Text style={s.label}>Комната</Text>
          <Chips options={rooms} value={roomId} onChange={setRoomId} empty="Не указана" />
        </>
      ) : null}
      {stages.length ? (
        <>
          <Text style={s.label}>Этап</Text>
          <Chips options={stages} value={stageId} onChange={setStageId} empty="Не указан" />
        </>
      ) : null}
      {error ? <Text style={s.error}>{error}</Text> : null}
      <View style={s.actions}>
        <PrimaryButton title={busy ? 'Сохраняем…' : 'Добавить замечание'} compact disabled={busy} onPress={() => { void submit(); }} />
        <PrimaryButton title="Отмена" variant="outline" compact disabled={busy} onPress={onCancel} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  box: { gap: RenovaTheme.spacing.sm, padding: RenovaTheme.spacing.md, borderRadius: RenovaTheme.radius.md, borderWidth: 1, borderColor: RenovaTheme.colors.border, backgroundColor: RenovaTheme.colors.surface },
  label: { ...screenTypography.listMeta, fontWeight: '600' },
  input: { borderWidth: 1, borderColor: RenovaTheme.colors.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, fontSize: 14, color: RenovaTheme.colors.text, backgroundColor: RenovaTheme.colors.background },
  multiline: { minHeight: 64, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, borderColor: RenovaTheme.colors.border, backgroundColor: RenovaTheme.colors.background },
  chipOn: { borderColor: RenovaTheme.colors.primary, backgroundColor: RenovaTheme.colors.infoBg },
  chipT: { fontSize: 13, color: RenovaTheme.colors.text },
  chipTOn: { fontWeight: '700' },
  error: { fontSize: 12, color: RenovaTheme.colors.dangerText },
  actions: { flexDirection: 'row', gap: RenovaTheme.spacing.sm, flexWrap: 'wrap' },
});
