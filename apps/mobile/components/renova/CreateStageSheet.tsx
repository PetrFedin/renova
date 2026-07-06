/** Создание нового этапа ремонта — исполнитель */
import { useState } from 'react';
import { Modal, View, Text, TextInput, StyleSheet, Pressable } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { RoomPickerChips } from '@/components/renova/RoomPickerChips';
import type { ProjectDetail } from '@/lib/api';

export function CreateStageSheet({
  visible,
  project,
  onClose,
  onCreate,
}: {
  visible: boolean;
  project: ProjectDetail;
  onClose: () => void;
  onCreate: (body: { name: string; planned_start?: string; planned_end?: string; room_ids?: string[] }) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [roomId, setRoomId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await onCreate({
        name: name.trim(),
        planned_start: start || undefined,
        planned_end: end || undefined,
        room_ids: roomId ? [roomId] : undefined,
      });
      setName('');
      setStart('');
      setEnd('');
      setRoomId(null);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.sheet} onPress={(e) => e.stopPropagation()}>
          <Text style={s.head}>Новый этап</Text>
          <TextInput style={s.inp} value={name} onChangeText={setName} placeholder="Название (например: Штукатурка)" />
          <TextInput style={s.inp} value={start} onChangeText={setStart} placeholder="Начало ГГГГ-ММ-ДД" />
          <TextInput style={s.inp} value={end} onChangeText={setEnd} placeholder="Окончание ГГГГ-ММ-ДД" />
          {project.rooms?.length ? (
            <RoomPickerChips rooms={project.rooms} value={roomId} onChange={setRoomId} optional />
          ) : null}
          <PrimaryButton title={busy ? 'Создание…' : 'Создать этап'} onPress={submit} disabled={busy} />
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
  inp: { borderWidth: 1, borderColor: RenovaTheme.colors.borderLight, borderRadius: 10, padding: 12, marginBottom: 8, fontSize: 15 },
});
