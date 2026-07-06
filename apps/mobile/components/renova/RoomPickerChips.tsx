/** Выбор комнаты — чеки, расходы */
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Room } from '@/lib/api';
import { roomTypeLabel } from '@/constants/roomTypes';
import { RenovaTheme } from '@/constants/Theme';

export function RoomPickerChips({ rooms, value, onChange, optional = true }: { rooms: Room[]; value?: string | null; onChange: (roomId: string | null) => void; optional?: boolean }) {
  return (
    <View style={s.wrap}>
      <Text style={s.lbl}>{optional ? 'Комната (необязательно)' : 'Комната'}</Text>
      <View style={s.row}>
        {optional && (
          <Pressable style={[s.chip, !value && s.on]} onPress={() => onChange(null)}>
            <Text style={[s.txt, !value && s.txtOn]}>Общее</Text>
          </Pressable>
        )}
        {rooms.map((r) => (
          <Pressable key={r.id} style={[s.chip, value === r.id && s.on]} onPress={() => onChange(r.id)}>
            <Text style={[s.txt, value === r.id && s.txtOn]}>{r.name}</Text>
            <Text style={[s.sub, value === r.id && s.txtOn]}>{roomTypeLabel(r.room_type)}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
const s = StyleSheet.create({
  wrap: { marginBottom: 10 }, lbl: { fontSize: 12, fontWeight: '600', color: RenovaTheme.colors.textMuted, marginBottom: 6 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: RenovaTheme.colors.border, minWidth: 72 },
  on: { backgroundColor: RenovaTheme.colors.primary }, txt: { fontWeight: '700', fontSize: 12, color: '#333' },
  sub: { fontSize: 9, color: '#666', marginTop: 1 }, txtOn: { color: RenovaTheme.colors.surface },
});
