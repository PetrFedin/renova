/** Привязка этапа к комнатам — пустой список = весь объект */
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Room } from '@/lib/api';
import { roomTypeLabel } from '@/constants/roomTypes';
import { RenovaTheme } from '@/constants/Theme';

export function StageRoomPicker({
  rooms,
  selected,
  onChange,
  disabled,
}: {
  rooms: Room[];
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const toggle = (id: string) => {
    if (disabled) return;
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };

  return (
    <View style={s.box}>
      <Text style={s.head}>Комнаты этапа</Text>
      <Text style={s.hint}>{selected.length ? `Выбрано: ${selected.length}` : 'Не выбрано — этап для всего объекта'}</Text>
      <View style={s.row}>
        {rooms.map((r) => {
          const on = selected.includes(r.id);
          return (
            <Pressable key={r.id} style={[s.chip, on && s.on, disabled && s.dis]} onPress={() => toggle(r.id)}>
              <Text style={[s.txt, on && s.txtOn]}>{r.name}</Text>
              <Text style={[s.sub, on && s.txtOn]}>{roomTypeLabel(r.room_type)}{(r.floor_level ?? 1) > 1 ? ` · ${r.floor_level} эт.` : ''}</Text>
            </Pressable>
          );
        })}
      </View>
      {!disabled && selected.length > 0 && (
        <Pressable onPress={() => onChange([])}><Text style={s.clear}>Сбросить — весь объект</Text></Pressable>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  box: { backgroundColor: '#fff', padding: 12, borderRadius: 10, marginBottom: 10 },
  head: { fontWeight: '800', marginBottom: 4 },
  hint: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginBottom: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, backgroundColor: '#eee', minWidth: 88 },
  on: { backgroundColor: RenovaTheme.colors.primary },
  dis: { opacity: 0.7 },
  txt: { fontWeight: '700', fontSize: 13, color: '#333' },
  sub: { fontSize: 10, color: '#666', marginTop: 2 },
  txtOn: { color: '#fff' },
  clear: { marginTop: 8, color: RenovaTheme.colors.primary, fontWeight: '600', fontSize: 12 },
});
