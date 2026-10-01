/** Создание комнаты — исполнитель (Объект → Комнаты) */
import { useEffect, useState } from 'react';
import { Modal, View, Text, StyleSheet, ScrollView } from 'react-native';
import { notifyAlert, notifyError } from '@/lib/notify';
import { isRateLimitError } from '@/lib/api';
import { parseNonNegativeInt, parsePositiveNumber } from '@/lib/parseLocaleNumber';
import { RenovaTheme } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import type { RoomTypeId } from '@/constants/roomTypes';
import type { ProjectDetail } from '@/lib/api';
import {
  RoomFormGuideBox,
  PropertyTypeBanner,
  RoomNameField,
  RoomTypeSection,
  RoomFloorSection,
  RoomDimensionsSection,
  RoomEngineeringSection,
  applyRoomTypePreset,
} from '@/components/renova/room/RoomSetupFields';
import { useRenova } from '@/lib/context/RenovaContext';
import { alertRoomCreated } from '@/lib/fieldCreateNav';
import type { OsRole } from '@/constants/osSections';

export function CreateRoomSheet({
  visible,
  project,
  onClose,
  onCreate,
  requestMode = false,
}: {
  /** Заказчик при подключённом исполнителе: комната создаётся по запросу, а не сразу (QLT-007) */
  requestMode?: boolean;
  visible: boolean;
  project: ProjectDetail;
  onClose: () => void;
  onCreate: (body: {
    name: string;
    room_type?: string;
    floor_level?: number;
    length_m: number;
    width_m: number;
    height_m?: number;
    outlets_count?: number;
    switches_count?: number;
    plumbing_points?: number;
  }) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [roomType, setRoomType] = useState<RoomTypeId>('living');
  const [floor, setFloor] = useState(1);
  const [length, setLength] = useState('4.2');
  const [width, setWidth] = useState('3.1');
  const [height, setHeight] = useState('2.7');
  const [outlets, setOutlets] = useState('6');
  const [switches, setSwitches] = useState('2');
  const [plumbing, setPlumbing] = useState('0');
  const [busy, setBusy] = useState(false);
  const { user } = useRenova();
  const role = (user?.role === 'contractor' ? 'contractor' : 'customer') as OsRole;
  const [nameTouched, setNameTouched] = useState(false);
  const propertyType = project.property_type ?? 'apartment';

  const dimValues = { length, width, height, outlets, switches, plumbing };
  const dimSetters = {
    setLength,
    setWidth,
    setHeight,
    setOutlets,
    setSwitches,
    setPlumbing,
  };

  function applyPreset(type: RoomTypeId) {
    const preset = applyRoomTypePreset(type);
    if (!preset) return;
    if (!nameTouched || !name.trim()) setName(preset.name ?? '');
    if (preset.length) setLength(preset.length);
    if (preset.width) setWidth(preset.width);
    if (preset.height) setHeight(preset.height);
    if (preset.outlets) setOutlets(preset.outlets);
    if (preset.switches) setSwitches(preset.switches);
    if (preset.plumbing) setPlumbing(preset.plumbing);
    if (preset.floor && propertyType === 'house') setFloor(preset.floor);
  }

  function resetForm() {
    setName('');
    setRoomType('living');
    setFloor(1);
    setLength('4.2');
    setWidth('3.1');
    setHeight('2.7');
    setOutlets('6');
    setSwitches('2');
    setPlumbing('0');
    setNameTouched(false);
  }

  /** При открытии сбрасываем форму и подставляем пресет «Гостиная» */
  useEffect(() => {
    if (!visible) return;
    resetForm();
    applyPreset('living');
  }, [visible]);

  async function submit() {
    const len = parsePositiveNumber(length);
    const wid = parsePositiveNumber(width);
    const hei = height.trim() ? parsePositiveNumber(height) : 2.7;
    const outletsN = outlets.trim() ? parseNonNegativeInt(outlets) : 0;
    const switchesN = switches.trim() ? parseNonNegativeInt(switches) : 0;
    const plumbingN = plumbing.trim() ? parseNonNegativeInt(plumbing) : 0;
    if (!name.trim()) return;
    if (len === null || wid === null || hei === null) {
      notifyAlert('Размеры комнаты', 'Длина, ширина и высота — положительные числа в метрах, например 4,2.');
      return;
    }
    if (outletsN === null || switchesN === null || plumbingN === null) {
      notifyAlert('Количество точек', 'Розетки, выключатели и точки воды — целые числа от 0.');
      return;
    }
    setBusy(true);
    try {
      await onCreate({
        name: name.trim(),
        room_type: roomType,
        floor_level: propertyType === 'house' ? floor : 1,
        length_m: len,
        width_m: wid,
        height_m: hei,
        outlets_count: outletsN,
        switches_count: switchesN,
        plumbing_points: plumbingN,
      });
      resetForm();
      onClose();
      // W133: комната → план / смета (запрос комнаты подтверждает вызывающий экран)
      if (!requestMode) alertRoomCreated(role);
    } catch (e) {
      if (isRateLimitError(e)) {
        notifyAlert('Подождите', 'Слишком много запросов. Повторите через несколько секунд.');
      } else {
        notifyError('Ошибка', e, requestMode ? 'Не удалось отправить запрос' : 'Не удалось создать комнату');
      }
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = name.trim().length > 0 && parsePositiveNumber(length) !== null && parsePositiveNumber(width) !== null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.sheet}>
          <Text style={s.head}>{requestMode ? 'Запрос новой комнаты' : 'Новая комната'}</Text>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <RoomFormGuideBox compact />
            <PropertyTypeBanner propertyType={propertyType} />
            <RoomNameField
              value={name}
              onChange={(v) => {
                setName(v);
                setNameTouched(true);
              }}
              roomType={roomType}
            />
            <RoomTypeSection value={roomType} onChange={setRoomType} onPreset={applyPreset} />
            <RoomFloorSection
              propertyType={propertyType}
              value={floor}
              onChange={setFloor}
              max={propertyType === 'house' ? 3 : 1}
            />
            <RoomDimensionsSection values={dimValues} setters={dimSetters} />
            <RoomEngineeringSection values={dimValues} setters={dimSetters} />
            <PrimaryButton
              title={busy ? (requestMode ? 'Отправка…' : 'Создание…') : (requestMode ? 'Отправить запрос' : 'Создать комнату')}
              onPress={submit}
              disabled={busy || !canSubmit}
            />
            {!canSubmit ? (
              <Text style={s.validation}>Укажите название, длину и ширину — без них комната не сохранится.</Text>
            ) : null}
            <PrimaryButton title="Отмена" variant="outline" onPress={onClose} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: RenovaTheme.colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    paddingBottom: 28,
    maxHeight: '92%',
  },
  head: { fontSize: 17, fontWeight: '800', marginBottom: 12 },
  validation: { fontSize: 12, color: RenovaTheme.colors.warning, textAlign: 'center', marginVertical: 8 },
});
