/** Поля настройки комнаты — фильтры, габариты с подписями, подсказки */
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { RenovaTheme, card } from '@/constants/Theme';
import type { RoomTypeId } from '@/constants/roomTypes';
import { ROOM_PRESETS } from '@/constants/roomTypes';
import { ROOM_FORM_GUIDE, ROOM_FORM_HINTS, propertyTypeLabel } from '@/constants/roomFormHints';
import { RoomTypePicker, FloorLevelPicker } from '@/components/renova/RoomTypePicker';
import { calcRoomMetrics } from '@/lib/roomMetrics';

type DimValues = {
  length: string;
  width: string;
  height: string;
  outlets: string;
  switches: string;
  plumbing: string;
};

type DimSetters = {
  setLength: (v: string) => void;
  setWidth: (v: string) => void;
  setHeight: (v: string) => void;
  setOutlets: (v: string) => void;
  setSwitches: (v: string) => void;
  setPlumbing: (v: string) => void;
};

export function RoomFormGuideBox({ compact }: { compact?: boolean }) {
  return (
    <View style={[s.guide, compact && s.guideCompact]}>
      <Text style={s.guideTitle}>{ROOM_FORM_GUIDE.title}</Text>
      <Text style={s.guideLine}>• {ROOM_FORM_GUIDE.required}</Text>
      <Text style={s.guideLine}>• {ROOM_FORM_GUIDE.recommended}</Text>
      {!compact ? <Text style={s.guideLine}>• {ROOM_FORM_GUIDE.optional}</Text> : null}
      <Text style={[s.guideTitle, { marginTop: 8 }]}>{ROOM_FORM_GUIDE.missingTitle}</Text>
      <Text style={s.guideWarn}>• {ROOM_FORM_GUIDE.missingDimensions}</Text>
      <Text style={s.guideWarn}>• {ROOM_FORM_GUIDE.missingType}</Text>
    </View>
  );
}

export function PropertyTypeBanner({ propertyType }: { propertyType: string }) {
  const isHouse = propertyType === 'house';
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>Тип жилья объекта</Text>
      <View style={s.propertyBadge}>
        <Text style={s.propertyLabel}>{propertyTypeLabel(propertyType)}</Text>
        <Text style={s.propertyHint}>
          {isHouse ? ROOM_FORM_HINTS.propertyHouse : ROOM_FORM_HINTS.propertyApartment}
        </Text>
      </View>
    </View>
  );
}

export function RoomNameField({
  value,
  onChange,
  roomType,
}: {
  value: string;
  onChange: (v: string) => void;
  roomType: RoomTypeId;
}) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>Название комнаты</Text>
      <LabeledInput
        value={value}
        onChangeText={onChange}
        placeholder="Например: Кухня, Спальня, Прихожая"
        hint={roomType === 'other' ? ROOM_FORM_HINTS.nameCustomType : ROOM_FORM_HINTS.name}
      />
    </View>
  );
}

export function RoomTypeSection({
  value,
  onChange,
  onPreset,
}: {
  value: RoomTypeId;
  onChange: (id: RoomTypeId) => void;
  onPreset?: (type: RoomTypeId) => void;
}) {
  return (
    <RoomTypePicker
      title="Фильтр 1 · Тип помещения"
      value={value}
      onChange={(id) => {
        onChange(id);
        onPreset?.(id);
      }}
    />
  );
}

export function RoomFloorSection({
  propertyType,
  value,
  onChange,
  max = 3,
}: {
  propertyType: string;
  value: number;
  onChange: (n: number) => void;
  max?: number;
}) {
  const isHouse = propertyType === 'house';
  return (
    <FloorLevelPicker
      title="Фильтр 2 · Этаж"
      value={isHouse ? value : 1}
      onChange={onChange}
      max={isHouse ? max : 1}
      disabled={!isHouse}
    />
  );
}

export function RoomDimensionsSection({
  values,
  setters,
}: {
  values: DimValues;
  setters: DimSetters;
}) {
  const len = parseFloat(values.length);
  const wid = parseFloat(values.width);
  const hei = parseFloat(values.height) || 2.7;
  const preview = len > 0 && wid > 0 ? calcRoomMetrics(len, wid, hei) : null;

  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>Габариты</Text>
      <Text style={s.sectionHint}>Измерьте по полу и укажите в метрах (можно с десятичной точкой)</Text>
      <View style={s.row}>
        <View style={s.half}>
          <LabeledInput
            label="Длина"
            value={values.length}
            onChangeText={setters.setLength}
            placeholder="4.2"
            keyboardType="decimal-pad"
            hint={ROOM_FORM_HINTS.length}
          />
        </View>
        <View style={s.half}>
          <LabeledInput
            label="Ширина"
            value={values.width}
            onChangeText={setters.setWidth}
            placeholder="3.1"
            keyboardType="decimal-pad"
            hint={ROOM_FORM_HINTS.width}
          />
        </View>
      </View>
      <LabeledInput
        label="Высота потолка"
        value={values.height}
        onChangeText={setters.setHeight}
        placeholder="2.7"
        keyboardType="decimal-pad"
        hint={ROOM_FORM_HINTS.height}
      />
      {preview ? (
        <View style={s.preview}>
          <Text style={s.previewTitle}>{ROOM_FORM_HINTS.preview}</Text>
          <Text style={s.previewLine}>Пол {preview.floor_sq_m} м² · Стены {preview.wall_sq_m} м² · Периметр {preview.perimeter_m} м</Text>
        </View>
      ) : null}
    </View>
  );
}

export function RoomEngineeringSection({ values, setters }: { values: DimValues; setters: DimSetters }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>Инженерия (можно позже)</Text>
      <Text style={s.sectionHint}>Влияет на смету электрики и сантехники — можно изменить в карточке комнаты</Text>
      <View style={s.row}>
        <View style={s.third}>
          <LabeledInput
            label="Розетки"
            value={values.outlets}
            onChangeText={setters.setOutlets}
            placeholder="4"
            keyboardType="number-pad"
            hint={ROOM_FORM_HINTS.outlets}
          />
        </View>
        <View style={s.third}>
          <LabeledInput
            label="Выключ."
            value={values.switches}
            onChangeText={setters.setSwitches}
            placeholder="2"
            keyboardType="number-pad"
            hint={ROOM_FORM_HINTS.switches}
          />
        </View>
        <View style={s.third}>
          <LabeledInput
            label="Сантех."
            value={values.plumbing}
            onChangeText={setters.setPlumbing}
            placeholder="0"
            keyboardType="number-pad"
            hint={ROOM_FORM_HINTS.plumbing}
          />
        </View>
      </View>
    </View>
  );
}

/** Применить типовые размеры при выборе типа */
export function applyRoomTypePreset(type: RoomTypeId): Partial<DimValues & { name: string; floor: number }> | null {
  const preset = ROOM_PRESETS.find((p) => p.room_type === type);
  if (!preset) return null;
  return {
    name: preset.name,
    floor: preset.floor_level ?? 1,
    length: String(preset.length_m),
    width: String(preset.width_m),
    height: String(preset.height_m),
    outlets: String(preset.outlets_count),
    switches: String(preset.switches_count),
    plumbing: String(preset.plumbing_points),
  };
}

function LabeledInput({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  hint,
}: {
  label?: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'decimal-pad' | 'number-pad' | 'default';
  hint: string;
}) {
  return (
    <View style={s.field}>
      {label ? <Text style={s.fieldLabel}>{label}</Text> : null}
      <TextInput
        style={s.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        keyboardType={keyboardType}
        placeholderTextColor={RenovaTheme.colors.textMuted}
      />
      <Text style={s.fieldHint}>{hint}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  guide: {
    ...card,
    marginBottom: 12,
    backgroundColor: '#F8FAFC',
    borderLeftWidth: 3,
    borderLeftColor: RenovaTheme.colors.primary,
  },
  guideCompact: { paddingVertical: 10 },
  guideTitle: { fontSize: 11, fontWeight: '700', color: RenovaTheme.colors.textMuted, textTransform: 'uppercase', marginBottom: 4 },
  guideLine: { fontSize: 12, color: RenovaTheme.colors.text, lineHeight: 17, marginBottom: 2 },
  guideWarn: { fontSize: 12, color: '#92400E', lineHeight: 17, marginBottom: 2 },
  section: { marginBottom: 14 },
  sectionTitle: { fontSize: 13, fontWeight: '800', color: RenovaTheme.colors.text, marginBottom: 4 },
  sectionHint: { fontSize: 12, color: RenovaTheme.colors.textMuted, lineHeight: 16, marginBottom: 8 },
  propertyBadge: { ...card, backgroundColor: RenovaTheme.colors.infoBg, paddingVertical: 10 },
  propertyLabel: { fontSize: 15, fontWeight: '800', color: RenovaTheme.colors.primary },
  propertyHint: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginTop: 4, lineHeight: 16 },
  row: { flexDirection: 'row', gap: 8 },
  half: { flex: 1 },
  third: { flex: 1 },
  field: { marginBottom: 4 },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: RenovaTheme.colors.text, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: RenovaTheme.colors.borderLight,
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    backgroundColor: RenovaTheme.colors.surface,
  },
  fieldHint: { fontSize: 11, color: RenovaTheme.colors.textMuted, marginTop: 4, lineHeight: 14 },
  preview: { marginTop: 8, padding: 10, borderRadius: 8, backgroundColor: '#ECFDF5', borderWidth: 1, borderColor: '#A7F3D0' },
  previewTitle: { fontSize: 11, fontWeight: '700', color: '#065F46', marginBottom: 2 },
  previewLine: { fontSize: 13, fontWeight: '600', color: '#047857' },
});
