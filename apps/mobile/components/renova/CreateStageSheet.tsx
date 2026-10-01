/** Создание нового этапа ремонта — исполнитель */
import { useState } from 'react';
import { Text, TextInput } from 'react-native';
import { notifyError } from '@/lib/notify';
import { SheetSurface, sheetContentStyles } from '@/components/renova/SheetSurface';
import { checkDateRange } from '@/lib/validateDate';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { RoomPickerChips } from '@/components/renova/RoomPickerChips';
import type { ProjectDetail } from '@/lib/api';
import { isOfflineQueued, notifyOfflineQueued } from '@/lib/offlineUi';
import { useRenova } from '@/lib/context/RenovaContext';
import { alertStageCreated } from '@/lib/fieldCommsNav';
import type { OsRole } from '@/constants/osSections';

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
  const { user } = useRenova();
  const role: OsRole = user?.role === 'customer' ? 'customer' : 'contractor';
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim() || busy) return;
    const dates = checkDateRange(start, end);
    if (!dates.ok) { setFormError(dates.error); return; }
    setFormError(null);
    setBusy(true);
    try {
      await onCreate({
        name: name.trim(),
        planned_start: dates.start,
        planned_end: dates.end,
        room_ids: roomId ? [roomId] : undefined,
      });
      reset();
      onClose();
      // W134: этап → график / работы
      alertStageCreated(role);
    } catch (e: unknown) {
      // W113: offline из createStage
      if (isOfflineQueued(e)) {
        notifyOfflineQueued('Этап');
        reset();
        onClose();
      } else {
        notifyError('Ошибка', e, 'Не удалось создать этап');
      }
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setName('');
    setStart('');
    setEnd('');
    setRoomId(null);
    setFormError(null);
  }

  return (
    <SheetSurface
      visible={visible}
      onClose={onClose}
      busy={busy}
      title="Новый этап"
      footer={
        <>
          <PrimaryButton title={busy ? 'Создание…' : 'Создать этап'} onPress={() => { void submit(); }} loading={busy} disabled={busy || !name.trim()} />
          <PrimaryButton title="Отмена" variant="outline" onPress={onClose} disabled={busy} />
        </>
      }
    >
      <TextInput style={sheetContentStyles.input} value={name} onChangeText={setName} placeholder="Название (например: Штукатурка)" />
      <TextInput style={sheetContentStyles.input} value={start} onChangeText={(v: string) => { setStart(v); setFormError(null); }} placeholder="Начало: ДД.ММ.ГГГГ" keyboardType="numbers-and-punctuation" />
      <TextInput style={sheetContentStyles.input} value={end} onChangeText={(v: string) => { setEnd(v); setFormError(null); }} placeholder="Окончание: ДД.ММ.ГГГГ" keyboardType="numbers-and-punctuation" />
      {formError ? <Text style={sheetContentStyles.note} accessibilityRole="alert">{formError}</Text> : null}
      {project.rooms?.length ? (
        <RoomPickerChips rooms={project.rooms} value={roomId} onChange={setRoomId} optional />
      ) : null}
    </SheetSurface>
  );
}
