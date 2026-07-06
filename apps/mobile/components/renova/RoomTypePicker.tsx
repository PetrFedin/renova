import { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { ROOM_TYPES, roomTypeLabel, type RoomTypeId } from '@/constants/roomTypes';
import { ROOM_FORM_HINTS } from '@/constants/roomFormHints';
import { RenovaTheme } from '@/constants/Theme';
import { FilterDropdown } from '@/components/renova/FilterDropdown';

const FLOOR_CUSTOM = 'custom';

function floorDisplayLabel(value: number, customMode: boolean): string {
  if (customMode || value > 5) return `${value}-й этаж`;
  return `${value}-й этаж`;
}

export function RoomTypePicker({
  value,
  onChange,
  title = 'Фильтр 1 · Тип помещения',
}: {
  value?: string | null;
  onChange: (id: RoomTypeId) => void;
  title?: string;
}) {
  const selected = (value || 'living') as RoomTypeId;
  const options = useMemo(
    () => ROOM_TYPES.map((t) => ({ value: t.id, label: t.label })),
    [],
  );

  return (
    <View style={s.wrap}>
      <FilterDropdown
        title={title}
        hint={ROOM_FORM_HINTS.roomType}
        value={selected}
        options={options}
        onChange={onChange}
        displayLabel={roomTypeLabel(selected)}
      />
      {selected === 'other' ? (
        <Text style={s.note}>Типа нет в списке — укажите своё название комнаты выше.</Text>
      ) : null}
    </View>
  );
}

export function FloorLevelPicker({
  value,
  onChange,
  max = 3,
  title = 'Фильтр 2 · Этаж',
  disabled,
}: {
  value: number;
  onChange: (n: number) => void;
  max?: number;
  title?: string;
  disabled?: boolean;
}) {
  const [customMode, setCustomMode] = useState(value > max);
  const [customText, setCustomText] = useState(value > max ? String(value) : '');

  useEffect(() => {
    if (value <= max) {
      setCustomMode(false);
      setCustomText('');
    } else {
      setCustomMode(true);
      setCustomText(String(value));
    }
  }, [value, max]);

  const options = useMemo(() => {
    const list = Array.from({ length: max }, (_, i) => {
      const n = i + 1;
      return { value: String(n), label: `${n}-й этаж` };
    });
    list.push({ value: FLOOR_CUSTOM, label: 'Другой этаж…' });
    return list;
  }, [max]);

  const currentKey = customMode || value > max ? FLOOR_CUSTOM : String(value);

  if (disabled || max <= 1) {
    return (
      <View style={s.wrap}>
        <FilterDropdown
          title={title}
          hint={ROOM_FORM_HINTS.floor}
          value="1"
          options={[{ value: '1', label: '1-й этаж' }]}
          onChange={() => {}}
          displayLabel="1-й этаж"
          disabled
        />
        <Text style={s.apartmentNote}>Для квартиры все комнаты на одном уровне</Text>
      </View>
    );
  }

  return (
    <View style={s.wrap}>
      <FilterDropdown
        title={title}
        hint={ROOM_FORM_HINTS.floor}
        value={currentKey}
        options={options}
        displayLabel={floorDisplayLabel(value, customMode || value > max)}
        onChange={(key) => {
          if (key === FLOOR_CUSTOM) {
            setCustomMode(true);
            if (customText) {
              const n = parseInt(customText, 10);
              if (n > 0) onChange(n);
            }
            return;
          }
          setCustomMode(false);
          setCustomText('');
          onChange(parseInt(key, 10));
        }}
      />
      {customMode ? (
        <>
          <TextInput
            style={s.customInp}
            value={customText}
            onChangeText={(t) => {
              setCustomText(t);
              const n = parseInt(t, 10);
              if (n > 0) onChange(n);
            }}
            keyboardType="number-pad"
            placeholder="Номер этажа"
            placeholderTextColor={RenovaTheme.colors.textMuted}
          />
          <Text style={s.hint}>{ROOM_FORM_HINTS.floorCustom}</Text>
        </>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginBottom: 0 },
  note: { fontSize: 12, color: '#92400E', marginTop: -6, marginBottom: 8, lineHeight: 16 },
  apartmentNote: { fontSize: 11, color: RenovaTheme.colors.textMuted, marginTop: -6, marginBottom: 8, lineHeight: 14 },
  customInp: {
    marginTop: -6,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.borderLight,
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    backgroundColor: '#fff',
  },
  hint: { fontSize: 11, color: RenovaTheme.colors.textMuted, marginBottom: 8, lineHeight: 14 },
});
